import { PrismaClient, Prisma } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { AppError } from "../shared/errors/index.js";
import { bookingQuoteService } from "./booking-quote.service.js";
import { availabilityService } from "./availability.service.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

export interface HoldResourceInput {
  serviceIndex: number; // Index into quote.services array
  artistId?: string; // Specific artist, or null for anonymous capacity
  startAt: Date;
  endAt: Date;
}

export interface CreateHoldRequest {
  quoteId: string;
  resources: HoldResourceInput[];
  idempotencyKey: string;
}

export interface CreateHoldResponse {
  holdId: string;
  status: string;
  expiresAt: Date;
  totalAdvanceAmount: number;
  advanceRule: string;
  resources: Array<{
    id: string;
    serviceIndex: number;
    artistId?: string;
    startAt: Date;
    endAt: Date;
    resourceType: string;
  }>;
}

export interface ValidateHoldRequest {
  holdId: string;
  expectedResources: HoldResourceInput[];
}

export class BookingHoldService {
  private readonly HOLD_TTL_MINUTES = 8;

  /**
   * Create a booking hold from a valid quote
   */
  async createHold(request: CreateHoldRequest, clientId: string): Promise<CreateHoldResponse> {
    const { quoteId, resources, idempotencyKey } = request;

    // Check idempotency key first
    const existingKey = await prisma.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
    if (existingKey) {
      // Return cached response if exists
      if (existingKey.responseBody) {
        return existingKey.responseBody as unknown as CreateHoldResponse;
      }
      throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key already used with different request');
    }

    // Get and validate quote
    const quote = await prisma.bookingQuote.findUnique({ where: { id: quoteId } });
    if (!quote) {
      throw new AppError(404, 'NOT_FOUND', 'Quote not found');
    }
    if (quote.clientId !== clientId) {
      throw new AppError(403, 'FORBIDDEN', 'Quote does not belong to this client');
    }
    if (new Date() > quote.expiresAt) {
      throw new AppError(410, 'QUOTE_EXPIRED', 'Quote has expired');
    }

    // Validate each resource against quote services
    const quoteServices = quote.services as any[];
    for (let i = 0; i < resources.length; i++) {
      const resource = resources[i];
      if (resource.serviceIndex < 0 || resource.serviceIndex >= quoteServices.length) {
        throw new AppError(400, 'VALIDATION_ERROR', `Invalid serviceIndex: ${resource.serviceIndex}`);
      }
    }

    // Validate slot availability for each resource
    for (const resource of resources) {
      const isAvailable = await availabilityService.validateSlotAvailability(
        resource.artistId || '', // Will check all if anonymous
        resource.startAt,
        resource.endAt
      );
      if (!isAvailable) {
        throw new AppError(409, 'SLOT_UNAVAILABLE', `Time slot no longer available for resource ${resources.indexOf(resource)}`);
      }
    }

    // Create hold and resources in transaction
    const hold = await prisma.$transaction(async (tx) => {
      const newHold = await tx.bookingHold.create({
        data: {
          clientId,
          quoteId,
          status: 'HOLD_ACTIVE',
          expiresAt: new Date(Date.now() + this.HOLD_TTL_MINUTES * 60000),
          totalAdvanceAmount: quote.advanceRequired,
          advanceRule: quote.advanceRule,
          idempotencyKey,
        },
      });

      // Create hold resources
      const holdResources = await Promise.all(resources.map(r =>
        tx.bookingHoldResource.create({
          data: {
            holdId: newHold.id,
            bookingServiceId: null, // Not linked to booking yet
            artistId: r.artistId || null,
            resourceType: r.artistId ? 'ARTIST_SLOT' : 'ANONYMOUS_CAPACITY',
            startAt: r.startAt,
            endAt: r.endAt,
          },
        })
      ));

      return { hold: newHold, resources: holdResources };
    });

    // Record idempotency key
    await prisma.idempotencyKey.create({
      data: {
        key: idempotencyKey,
        endpoint: '/api/v1/booking-holds',
        method: 'POST',
        requestHash: this.hashRequest(request),
        responseStatus: 201,
        responseBody: {
          holdId: hold.hold.id,
          status: hold.hold.status,
          expiresAt: hold.hold.expiresAt,
          totalAdvanceAmount: Number(hold.hold.totalAdvanceAmount),
          advanceRule: hold.hold.advanceRule,
          resources: hold.resources.map(r => ({
            id: r.id,
            serviceIndex: resources.findIndex(res => res.startAt.getTime() === r.startAt.getTime()),
            artistId: r.artistId || undefined,
            startAt: r.startAt,
            endAt: r.endAt,
            resourceType: r.resourceType,
          })),
        },
        expiresAt: hold.hold.expiresAt,
      },
    });

    return {
      holdId: hold.hold.id,
      status: hold.hold.status,
      expiresAt: hold.hold.expiresAt,
      totalAdvanceAmount: Number(hold.hold.totalAdvanceAmount),
      advanceRule: hold.hold.advanceRule,
      resources: hold.resources.map((r, idx) => ({
        id: r.id,
        serviceIndex: resources[idx]?.serviceIndex ?? 0,
        artistId: r.artistId || undefined,
        startAt: r.startAt,
        endAt: r.endAt,
        resourceType: r.resourceType,
      })),
    };
  }

  /**
   * Get hold by ID
   */
  async getHold(holdId: string, clientId: string) {
    const hold = await prisma.bookingHold.findUnique({
      where: { id: holdId },
      include: { resources: true },
    });

    if (!hold) {
      throw new AppError(404, 'NOT_FOUND', 'Hold not found');
    }
    if (hold.clientId !== clientId) {
      throw new AppError(403, 'FORBIDDEN', 'Hold does not belong to this client');
    }

    return hold;
  }

  /**
   * Release a hold early
   */
  async releaseHold(holdId: string, clientId: string) {
    const hold = await this.getHold(holdId, clientId);

    if (hold.status !== 'HOLD_ACTIVE') {
      throw new AppError(400, 'INVALID_STATE', 'Hold is not active');
    }

    await prisma.$transaction(async (tx) => {
      await tx.bookingHold.update({
        where: { id: holdId },
        data: {
          status: 'HOLD_RELEASED',
          releasedAt: new Date(),
        },
      });
    });

    return { success: true };
  }

  /**
   * Extend hold expiration (for client progressing to payment)
   */
  async extendHold(holdId: string, clientId: string, additionalMinutes: number = 5) {
    const hold = await this.getHold(holdId, clientId);

    if (hold.status !== 'HOLD_ACTIVE') {
      throw new AppError(400, 'INVALID_STATE', 'Hold is not active');
    }

    const newExpiresAt = new Date(hold.expiresAt.getTime() + additionalMinutes * 60000);

    await prisma.bookingHold.update({
      where: { id: holdId },
      data: { expiresAt: newExpiresAt },
    });

    return { expiresAt: newExpiresAt };
  }

  /**
   * Consume hold (convert to booking) - called during booking creation
   */
  async consumeHold(holdId: string, bookingId: string) {
    const hold = await prisma.bookingHold.findUnique({
      where: { id: holdId },
      include: { resources: true },
    });

    if (!hold) {
      throw new AppError(404, 'NOT_FOUND', 'Hold not found');
    }
    if (hold.status !== 'HOLD_ACTIVE') {
      throw new AppError(400, 'INVALID_STATE', 'Hold is not active');
    }

    await prisma.$transaction(async (tx) => {
      await tx.bookingHold.update({
        where: { id: holdId },
        data: {
          status: 'HOLD_CONSUMED',
          consumedAt: new Date(),
          bookingId,
        },
      });
    });

    return { success: true };
  }

  /**
   * Clean up expired holds (background job)
   */
  async cleanupExpiredHolds() {
    const expiredHolds = await prisma.bookingHold.findMany({
      where: {
        status: 'HOLD_ACTIVE',
        expiresAt: { lt: new Date() },
      },
      include: { resources: true },
    });

    for (const hold of expiredHolds) {
      await prisma.bookingHold.update({
        where: { id: hold.id },
        data: { status: 'HOLD_EXPIRED', releasedAt: new Date() },
      });
    }

    return { cleaned: expiredHolds.length };
  }

  private hashRequest(request: CreateHoldRequest): string {
    // Simple hash for idempotency - in production use crypto
    const str = JSON.stringify({
      quoteId: request.quoteId,
      resources: request.resources.map(r => ({
        serviceIndex: r.serviceIndex,
        artistId: r.artistId,
        startAt: r.startAt.toISOString(),
        endAt: r.endAt.toISOString(),
      })),
    });
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }
}

export const bookingHoldService = new BookingHoldService();