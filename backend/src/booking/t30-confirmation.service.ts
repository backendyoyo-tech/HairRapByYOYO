import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { AppError } from "../shared/errors/index.js";
import { availabilityService } from "./availability.service.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

export interface T30QueueItem {
  id: string;
  bookingId: string;
  bookingServiceId: string;
  artistId: string;
  appointmentDate: Date;
  status: 'PENDING' | 'CONFIRMED' | 'EXCEPTION' | 'RECOVERY';
  createdAt: Date;
  processedAt?: Date;
  processedBy?: string;
}

export interface ConfirmProvisionalRequest {
  bookingServiceId: string;
  idempotencyKey: string;
}

export interface RecoveryOption {
  type: 'SAME_ARTIST_DIFFERENT_TIME' | 'SAME_TIME_DIFFERENT_ARTIST';
  artistId?: string;
  newStartAt?: Date;
  newEndAt?: Date;
  newArtistId?: string;
}

export interface ResolveUnavailableArtistRequest {
  bookingServiceId: string;
  recoveryOption: RecoveryOption;
  idempotencyKey: string;
}

export class T30ConfirmationService {
  /**
   * Get all provisional booking services that have reached T-30 window (30 days before appointment)
   * This is called by a daily cron job
   */
  async getT30Queue(): Promise<T30QueueItem[]> {
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    thirtyDaysFromNow.setHours(23, 59, 59, 999); // End of day

    const now = new Date();
    now.setHours(0, 0, 0, 0); // Start of today

    const provisionalServices = await prisma.bookingService.findMany({
      where: {
        artistConfirmationState: 'PROVISIONAL',
        plannedStartAt: {
          gte: now,
          lte: thirtyDaysFromNow,
        },
        requestedArtistId: { not: null },
      },
      include: {
        booking: {
          include: {
            client: { include: { account: { select: { id: true, email: true, phone: true } } } },
          },
        },
        service: true,
      },
    });

    return provisionalServices.map((bs) => ({
      id: `t30-${bs.id}`,
      bookingId: bs.bookingId,
      bookingServiceId: bs.id,
      artistId: bs.requestedArtistId!,
      appointmentDate: bs.plannedStartAt,
      status: 'PENDING',
      createdAt: new Date(),
    }));
  }

  /**
   * Revalidate a provisional booking service at T-30
   * Returns the revalidation result with any conflicts
   */
  async revalidateProvisionalBooking(bookingServiceId: string): Promise<{
    canConfirm: boolean;
    conflicts: string[];
    artistActive: boolean;
    artistEligible: boolean;
    shiftValid: boolean;
    noExceptions: boolean;
    noConflicts: boolean;
  }> {
    const bookingService = await prisma.bookingService.findUnique({
      where: { id: bookingServiceId },
      include: {
        booking: true,
        service: true,
        assignments: { where: { status: { in: ['PENDING', 'CONFIRMED'] } } },
      },
    });

    if (!bookingService) {
      throw new AppError(404, 'NOT_FOUND', 'Booking service not found');
    }

    if (bookingService.artistConfirmationState !== 'PROVISIONAL') {
      throw new AppError(400, 'INVALID_STATE', 'Booking service is not in PROVISIONAL state');
    }

    if (!bookingService.requestedArtistId) {
      throw new AppError(400, 'INVALID_STATE', 'No requested artist for provisional booking');
    }

    const artistId = bookingService.requestedArtistId;
    const conflicts: string[] = [];

    // 1. Check artist active status
    const artist = await prisma.artistProfile.findUnique({ where: { id: artistId } });
    const artistActive = artist?.isAvailable === true;
    if (!artistActive) conflicts.push('Artist is not active');

    // 2. Check artist eligibility for this service
    const artistService = await prisma.artistService.findFirst({
      where: { artistId, serviceId: bookingService.serviceId, isActive: true },
    });
    const artistEligible = !!artistService;
    if (!artistEligible) conflicts.push('Artist is not eligible for this service');

    // 3. Check shift/day-off
    const dayOfWeek = bookingService.plannedStartAt.getDay(); // 0=Sunday
    const shift = await prisma.artistWorkSchedule.findFirst({
      where: {
        artistId,
        dayOfWeek,
        isActive: true,
        startTime: { lte: bookingService.plannedStartAt },
        endTime: { gte: bookingService.plannedEndAt },
      },
    });
    const shiftValid = !!shift;
    if (!shiftValid) conflicts.push('Artist shift does not cover appointment time');

    // 4. Check schedule exceptions
    const exception = await prisma.artistScheduleException.findFirst({
      where: {
        artistId,
        exceptionDate: {
          gte: new Date(bookingService.plannedStartAt.getFullYear(), bookingService.plannedStartAt.getMonth(), bookingService.plannedStartAt.getDate()),
          lt: new Date(bookingService.plannedStartAt.getFullYear(), bookingService.plannedStartAt.getMonth(), bookingService.plannedStartAt.getDate() + 1),
        },
        isAvailable: false,
      },
    });
    const noExceptions = !exception;
    if (exception) conflicts.push('Artist has a blocking schedule exception');

    // 5. Check artist conflicts (existing assignments + holds)
    const occupiedWindowStart = bookingService.plannedStartAt;
    const occupiedWindowEnd = new Date(bookingService.plannedEndAt.getTime() + bookingService.bufferMinutes * 60000);

    const conflictingAssignments = await prisma.bookingServiceAssignment.findMany({
      where: {
        artistId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        bookingService: {
          plannedStartAt: { lt: occupiedWindowEnd },
          plannedEndAt: { gt: occupiedWindowStart },
          id: { not: bookingServiceId },
        },
      },
    });
    const noConflicts = conflictingAssignments.length === 0;
    if (!noConflicts) conflicts.push('Artist has conflicting assignments');

    const conflictingHolds = await prisma.bookingHoldResource.findMany({
      where: {
        artistId,
        startAt: { lt: occupiedWindowEnd },
        endAt: { gt: occupiedWindowStart },
        hold: { status: 'HOLD_ACTIVE' },
      },
    });
    if (conflictingHolds.length > 0) {
      conflicts.push('Artist has conflicting active holds');
    }

    const canConfirm = artistActive && artistEligible && shiftValid && noExceptions && noConflicts;

    return {
      canConfirm,
      conflicts,
      artistActive,
      artistEligible,
      shiftValid,
      noExceptions,
      noConflicts,
    };
  }

  /**
   * Confirm a provisional booking service (admin action)
   */
  async confirmProvisional(request: ConfirmProvisionalRequest, adminId: string): Promise<{ success: boolean; state: string }> {
    const { bookingServiceId, idempotencyKey } = request;

    // Check idempotency
    const existingKey = await prisma.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
    if (existingKey) {
      if (existingKey.responseBody) return existingKey.responseBody as { success: boolean; state: string };
      throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key already used');
    }

    const bookingService = await prisma.bookingService.findUnique({
      where: { id: bookingServiceId },
      include: { booking: true },
    });

    if (!bookingService) {
      throw new AppError(404, 'NOT_FOUND', 'Booking service not found');
    }

    if (bookingService.artistConfirmationState !== 'PROVISIONAL') {
      throw new AppError(400, 'INVALID_STATE', 'Booking service is not in PROVISIONAL state');
    }

    // Revalidate before confirming
    const validation = await this.revalidateProvisionalBooking(bookingServiceId);
    if (!validation.canConfirm) {
      throw new AppError(409, 'REVALIDATION_FAILED', `Cannot confirm: ${validation.conflicts.join(', ')}`);
    }

    // Update to FINAL
    await prisma.$transaction(async (tx) => {
      await tx.bookingService.update({
        where: { id: bookingServiceId },
        data: { artistConfirmationState: 'FINAL' },
      });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId: bookingService.bookingId,
          fromStatus: bookingService.booking.status,
          toStatus: bookingService.booking.status,
          actorType: 'STAFF',
          actorId: adminId,
          reason: 'Provisional specific artist confirmed at T-30',
        },
      });
    });

    // Record idempotency
    await prisma.idempotencyKey.create({
      data: {
        key: idempotencyKey,
        endpoint: '/api/v1/admin/t30/confirm',
        method: 'POST',
        requestHash: this.hashRequest(request),
        responseStatus: 200,
        responseBody: { success: true, state: 'FINAL' },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    return { success: true, state: 'FINAL' };
  }

  /**
   * Mark provisional booking as exception (artist unavailable at T-30)
   */
  async markProvisionalException(bookingServiceId: string, adminId: string): Promise<{ success: boolean; state: string }> {
    const bookingService = await prisma.bookingService.findUnique({
      where: { id: bookingServiceId },
      include: { booking: true },
    });

    if (!bookingService) {
      throw new AppError(404, 'NOT_FOUND', 'Booking service not found');
    }

    if (bookingService.artistConfirmationState !== 'PROVISIONAL') {
      throw new AppError(400, 'INVALID_STATE', 'Booking service is not in PROVISIONAL state');
    }

    await prisma.$transaction(async (tx) => {
      await tx.bookingService.update({
        where: { id: bookingServiceId },
        data: { artistConfirmationState: 'CONFIRMATION_EXCEPTION' },
      });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId: bookingService.bookingId,
          fromStatus: bookingService.booking.status,
          toStatus: bookingService.booking.status,
          actorType: 'STAFF',
          actorId: adminId,
          reason: 'Provisional specific artist cannot be confirmed at T-30 - artist unavailable',
        },
      });
    });

    return { success: true, state: 'CONFIRMATION_EXCEPTION' };
  }

  /**
   * Resolve unavailable artist for provisional booking (admin action with client choice)
   */
  async resolveUnavailableArtist(request: ResolveUnavailableArtistRequest, adminId: string): Promise<{ success: boolean }> {
    const { bookingServiceId, recoveryOption, idempotencyKey } = request;

    // Check idempotency
    const existingKey = await prisma.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
    if (existingKey) {
      if (existingKey.responseBody) return existingKey.responseBody as { success: boolean };
      throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key already used');
    }

    const bookingService = await prisma.bookingService.findUnique({
      where: { id: bookingServiceId },
      include: { booking: true, service: true },
    });

    if (!bookingService) {
      throw new AppError(404, 'NOT_FOUND', 'Booking service not found');
    }

    if (bookingService.artistConfirmationState !== 'CONFIRMATION_EXCEPTION') {
      throw new AppError(400, 'INVALID_STATE', 'Booking service must be in CONFIRMATION_EXCEPTION state');
    }

    let newArtistId: string | undefined;
    let newStartAt: Date | undefined;
    let newEndAt: Date | undefined;

    if (recoveryOption.type === 'SAME_ARTIST_DIFFERENT_TIME') {
      // Option A: Same artist, different time
      if (!recoveryOption.newStartAt || !recoveryOption.newEndAt) {
        throw new AppError(400, 'INVALID_REQUEST', 'newStartAt and newEndAt required for SAME_ARTIST_DIFFERENT_TIME');
      }
      newArtistId = bookingService.requestedArtistId || undefined;
      newStartAt = recoveryOption.newStartAt;
      newEndAt = recoveryOption.newEndAt;

      // Validate new slot for same artist
      const isAvailable = await availabilityService.validateSlotAvailability(
        newArtistId!,
        newStartAt,
        newEndAt
      );
      if (!isAvailable) {
        throw new AppError(409, 'SLOT_UNAVAILABLE', 'Requested artist not available at new time');
      }
    } else if (recoveryOption.type === 'SAME_TIME_DIFFERENT_ARTIST') {
      // Option B: Same time, different artist
      if (!recoveryOption.newArtistId) {
        throw new AppError(400, 'INVALID_REQUEST', 'newArtistId required for SAME_TIME_DIFFERENT_ARTIST');
      }
      newArtistId = recoveryOption.newArtistId;
      newStartAt = bookingService.plannedStartAt;
      newEndAt = bookingService.plannedEndAt;

      // Validate new artist eligibility
      const artistService = await prisma.artistService.findFirst({
        where: { artistId: newArtistId, serviceId: bookingService.serviceId, isActive: true },
      });
      if (!artistService) {
        throw new AppError(400, 'ARTIST_NOT_QUALIFIED', 'New artist not qualified for this service');
      }

      // Validate availability
      const isAvailable = await availabilityService.validateSlotAvailability(
        newArtistId,
        newStartAt,
        newEndAt
      );
      if (!isAvailable) {
        throw new AppError(409, 'SLOT_UNAVAILABLE', 'New artist not available at this time');
      }
    } else {
      throw new AppError(400, 'INVALID_REQUEST', 'Invalid recovery option type');
    }

    // Atomic swap: update booking service with new artist/time
    await prisma.$transaction(async (tx) => {
      await tx.bookingService.update({
        where: { id: bookingServiceId },
        data: {
          requestedArtistId: newArtistId,
          plannedStartAt: newStartAt!,
          plannedEndAt: newEndAt!,
          artistConfirmationState: 'FINAL',
        },
      });

      // Update assignment if exists
      const existingAssignment = await tx.bookingServiceAssignment.findFirst({
        where: { bookingServiceId, status: { in: ['PENDING', 'CONFIRMED'] } },
      });
      if (existingAssignment) {
        await tx.bookingServiceAssignment.update({
          where: { id: existingAssignment.id },
          data: { artistId: newArtistId!, status: 'CONFIRMED' },
        });
      }

      await tx.bookingStatusHistory.create({
        data: {
          bookingId: bookingService.bookingId,
          fromStatus: bookingService.booking.status,
          toStatus: bookingService.booking.status,
          actorType: 'STAFF',
          actorId: adminId,
          reason: `Artist unavailability resolved: ${recoveryOption.type}`,
        },
      });

      await tx.bookingRescheduleHistory.create({
        data: {
          bookingId: bookingService.bookingId,
          reason: `Artist unavailability recovery: ${recoveryOption.type}`,
          oldServicesJson: [{ ...bookingService }],
          newServicesJson: [{ ...bookingService, requestedArtistId: newArtistId, plannedStartAt: newStartAt, plannedEndAt: newEndAt }],
          moneyActionRequired: false,
          actorType: 'STAFF',
          actorId: adminId,
          idempotencyKey,
        },
      });
    });

    // Record idempotency
    await prisma.idempotencyKey.create({
      data: {
        key: idempotencyKey,
        endpoint: '/api/v1/admin/t30/resolve-unavailable',
        method: 'POST',
        requestHash: this.hashRequest(request),
        responseStatus: 200,
        responseBody: { success: true },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    return { success: true };
  }

  /**
   * Get recovery options for an unavailable artist (for admin/client presentation)
   */
  async getRecoveryOptions(bookingServiceId: string): Promise<{
    sameArtistSlots: Array<{ startAt: Date; endAt: Date }>;
    alternativeArtists: Array<{ artistId: string; artistName: string }>;
  }> {
    const bookingService = await prisma.bookingService.findUnique({
      where: { id: bookingServiceId },
      include: { service: true, booking: true },
    });

    if (!bookingService) {
      throw new AppError(404, 'NOT_FOUND', 'Booking service not found');
    }

    const artistId = bookingService.requestedArtistId;
    if (!artistId) {
      throw new AppError(400, 'INVALID_STATE', 'No requested artist');
    }

    // Find available slots for same artist within horizon
    const horizonEnd = new Date();
    horizonEnd.setDate(horizonEnd.getDate() + 60);

    const sameArtistSlotsResult = await availabilityService.searchAvailability({
      requestedStartDate: bookingService.plannedStartAt,
      services: [{ serviceId: bookingService.serviceId, requestedArtistId: artistId }],
    });

    // Filter to only the requested artist's slots
    const artistSlots = sameArtistSlotsResult
      .flatMap((s) => s.slots.filter((slot) => slot.artistId === artistId))
      .filter((slot) => slot.startAt > new Date() && slot.startAt < horizonEnd)
      .map((slot) => ({ startAt: slot.startAt, endAt: slot.endAt }));

    // Find alternative eligible artists for same time
    const allEligibleArtists = await prisma.artistService.findMany({
      where: { serviceId: bookingService.serviceId, isActive: true, artist: { isAvailable: true } },
      include: { artist: true },
    });

    const alternativeArtists = [];
    for (const as of allEligibleArtists) {
      if (as.artistId === artistId) continue;
      const isAvailable = await availabilityService.validateSlotAvailability(
        as.artistId,
        bookingService.plannedStartAt,
        bookingService.plannedEndAt
      );
      if (isAvailable) {
        alternativeArtists.push({ artistId: as.artistId, artistName: `${as.artist.firstName} ${as.artist.lastName}` });
      }
    }

    return { sameArtistSlots: artistSlots, alternativeArtists };
  }

  private hashRequest(request: any): string {
    const str = JSON.stringify(request);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }
}

export const t30ConfirmationService = new T30ConfirmationService();