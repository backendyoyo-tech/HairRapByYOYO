import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { AppError } from "../shared/errors/index.js";
import { availabilityService, AvailabilitySearchRequest, AvailabilitySlot } from "./availability.service.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

export interface QuoteServiceItem {
  serviceId: string;
  requestedArtistId?: string;
  assignmentStrategy: 'SPECIFIC_ARTIST' | 'AUTO_ASSIGN' | 'YOYO_ASSIGNED_TEAM';
}

export interface BookingQuoteRequest {
  serviceItems: QuoteServiceItem[];
  date: Date;
  partySize?: number;
}

export interface BookingQuoteResponse {
  quoteId: string;
  services: Array<{
    serviceId: string;
    serviceName: string;
    durationMinutes: number;
    price: number;
    requestedArtistId?: string;
    assignmentStrategy: string;
    availableSlots: AvailabilitySlot[];
  }>;
  serviceTotal: number;
  advanceRule: string;
  advanceRequired: number;
  expiresAt: Date;
  warnings: string[];
}

export class BookingQuoteService {
  private readonly QUOTE_TTL_MINUTES = 15;
  private readonly STANDARD_ADVANCE_PERCENT = 20;
  private readonly CREATIVE_DIRECTOR_FIXED_ADVANCE = 5000; // INR 5000

  /**
   * Generate a booking quote with pricing and availability
   */
  async createQuote(request: BookingQuoteRequest, clientId: string): Promise<BookingQuoteResponse> {
    const { serviceItems, date, partySize = 1 } = request;

    if (!serviceItems || serviceItems.length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'At least one service item is required');
    }

    // Validate all services exist
    const serviceIds = serviceItems.map(s => s.serviceId);
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds }, active: true },
      select: {
        id: true,
        name: true,
        durationMinutes: true,
        price: true,
        creativeDirectorEligible: true,
        requiredArtistCount: true,
      },
    });

    if (services.length !== serviceIds.length) {
      throw new AppError(404, 'NOT_FOUND', 'One or more services not found or inactive');
    }

    // Check availability for each service item
    const serviceResponses = [];
    const warnings: string[] = [];

    for (const item of serviceItems) {
      const service = services.find(s => s.id === item.serviceId);
      if (!service) continue;

      const availability = await availabilityService.searchAvailability({
        clientId,
        requestedStartDate: date,
        services: [{
          serviceId: item.serviceId,
          requestedArtistId: item.requestedArtistId,
        }],
        groupContext: { participantCount: partySize },
      });

      if (availability.length === 0 || availability[0].slots.length === 0) {
        warnings.push(`No availability for "${service.name}" on the requested date`);
      }

      serviceResponses.push({
        serviceId: service.id,
        serviceName: service.name,
        durationMinutes: service.durationMinutes,
        price: Number(service.price),
        requestedArtistId: item.requestedArtistId,
        assignmentStrategy: item.assignmentStrategy,
        availableSlots: availability[0]?.slots || [],
      });
    }

    // Calculate totals
    const serviceTotal = serviceResponses.reduce((sum, s) => sum + s.price, 0);

    // Determine advance rule
    const hasCreativeDirectorService = serviceResponses.some(s =>
      services.find(sv => sv.id === s.serviceId)?.creativeDirectorEligible &&
      s.assignmentStrategy === 'SPECIFIC_ARTIST'
    );

    const advanceRule = hasCreativeDirectorService
      ? 'SPECIFIC_CREATIVE_DIRECTOR_FIXED'
      : 'STANDARD_20_PERCENT';

    const advanceRequired = advanceRule === 'SPECIFIC_CREATIVE_DIRECTOR_FIXED'
      ? this.CREATIVE_DIRECTOR_FIXED_ADVANCE
      : Math.round(serviceTotal * this.STANDARD_ADVANCE_PERCENT / 100);

    // Create quote in database
    const expiresAt = new Date(Date.now() + this.QUOTE_TTL_MINUTES * 60000);

    const quote = await prisma.bookingQuote.create({
      data: {
        clientId,
        services: serviceItems.map(item => ({
          serviceId: item.serviceId,
          requestedArtistId: item.requestedArtistId,
          assignmentStrategy: item.assignmentStrategy,
        })),
        serviceTotal,
        advanceRule,
        advanceRequired,
        expiresAt,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    });

    return {
      quoteId: quote.id,
      services: serviceResponses,
      serviceTotal,
      advanceRule,
      advanceRequired,
      expiresAt,
      warnings,
    };
  }

  /**
   * Get quote by ID (for hold creation)
   */
  async getQuote(quoteId: string): Promise<BookingQuoteResponse | null> {
    const quote = await prisma.bookingQuote.findUnique({
      where: { id: quoteId },
    });

    if (!quote) return null;

    // Reconstruct service details
    const serviceItems = quote.services as unknown as QuoteServiceItem[];
    const serviceIds = serviceItems.map(s => s.serviceId);
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true, name: true, durationMinutes: true, price: true, creativeDirectorEligible: true, requiredArtistCount: true },
    });

    const serviceResponses = [];
    for (const item of serviceItems) {
      const service = services.find(s => s.id === item.serviceId);
      if (!service) continue;

      const availability = await availabilityService.searchAvailability({
        clientId: quote.clientId,
        requestedStartDate: new Date(), // We'd need to store the date in the quote for exact reconstruction
        services: [{
          serviceId: item.serviceId,
          requestedArtistId: item.requestedArtistId,
        }],
        groupContext: { participantCount: 1 },
      });

      serviceResponses.push({
        serviceId: service.id,
        serviceName: service.name,
        durationMinutes: service.durationMinutes,
        price: Number(service.price),
        requestedArtistId: item.requestedArtistId,
        assignmentStrategy: item.assignmentStrategy,
        availableSlots: availability[0]?.slots || [],
      });
    }

    return {
      quoteId: quote.id,
      services: serviceResponses,
      serviceTotal: Number(quote.serviceTotal),
      advanceRule: quote.advanceRule,
      advanceRequired: Number(quote.advanceRequired),
      expiresAt: quote.expiresAt,
      warnings: quote.warnings as string[] | undefined || [],
    };
  }

  /**
   * Check if quote is still valid
   */
  isQuoteValid(quote: BookingQuoteResponse): boolean {
    return new Date() < quote.expiresAt;
  }
}

export const bookingQuoteService = new BookingQuoteService();