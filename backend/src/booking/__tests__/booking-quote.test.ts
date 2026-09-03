import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BookingQuoteService, BookingQuoteRequest } from '../booking-quote.service.js';
import { availabilityService } from '../availability.service.js';

// Mock Prisma with proper structure
const mockPrisma = {
  service: {
    findMany: vi.fn(),
  },
  bookingQuote: {
    create: vi.fn(),
    findUnique: vi.fn(),
  },
};

// Mock the Prisma client module
vi.mock('../generated/prisma/client.js', () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}));

describe('D8.1 - Quote Request Validation', () => {
  let service: BookingQuoteService;

  beforeEach(() => {
    service = new BookingQuoteService();
    vi.clearAllMocks();
  });

  it('should validate a valid quote request', async () => {
    const request: BookingQuoteRequest = {
      serviceItems: [
        { serviceId: 'svc-1', assignmentStrategy: 'AUTO_ASSIGN' },
      ],
      date: new Date('2026-09-15T10:00:00Z'),
      partySize: 1,
    };

    mockPrisma.service.findMany.mockResolvedValue([
      { id: 'svc-1', name: 'Haircut', durationMinutes: 45, price: 1000, creativeDirectorEligible: false, requiredArtistCount: 1 },
    ]);

    const result = await service.createQuote(request, 'client-1');
    expect(result).toBeDefined();
    expect(result.services).toHaveLength(1);
    expect(result.serviceTotal).toBe(1000);
  });

  it('should reject empty service items', async () => {
    const request: BookingQuoteRequest = {
      serviceItems: [],
      date: new Date(),
    };

    await expect(service.createQuote(request, 'client-1')).rejects.toThrow('At least one service item is required');
  });

  it('should reject invalid service IDs', async () => {
    const request: BookingQuoteRequest = {
      serviceItems: [
        { serviceId: 'invalid-id', assignmentStrategy: 'AUTO_ASSIGN' },
      ],
      date: new Date(),
    };

    mockPrisma.service.findMany.mockResolvedValue([]);

    await expect(service.createQuote(request, 'client-1')).rejects.toThrow('One or more services not found or inactive');
  });

  it('should handle stale availability gracefully', async () => {
    vi.spyOn(availabilityService, 'searchAvailability').mockResolvedValue([]);

    const request: BookingQuoteRequest = {
      serviceItems: [
        { serviceId: 'svc-1', assignmentStrategy: 'AUTO_ASSIGN' },
      ],
      date: new Date('2026-09-15T10:00:00Z'),
    };

    mockPrisma.service.findMany.mockResolvedValue([
      { id: 'svc-1', name: 'Haircut', durationMinutes: 45, price: 1000, creativeDirectorEligible: false, requiredArtistCount: 1 },
    ]);

    const result = await service.createQuote(request, 'client-1');
    expect(result.warnings).toContain('No availability for "Haircut" on the requested date');
  });

  it('should validate creative director fixed advance rule', async () => {
    const request: BookingQuoteRequest = {
      serviceItems: [
        { serviceId: 'svc-cd', requestedArtistId: 'artist-1', assignmentStrategy: 'SPECIFIC_ARTIST' },
      ],
      date: new Date('2026-09-15T10:00:00Z'),
    };

    mockPrisma.service.findMany.mockResolvedValue([
      { id: 'svc-cd', name: 'Creative Hair', durationMinutes: 60, price: 5000, creativeDirectorEligible: true, requiredArtistCount: 1 },
    ]);

    const result = await service.createQuote(request, 'client-1');
    expect(result.advanceRule).toBe('SPECIFIC_CREATIVE_DIRECTOR_FIXED');
    expect(result.advanceRequired).toBe(5000);
  });

  it('should use standard 20% advance for auto-assign', async () => {
    const request: BookingQuoteRequest = {
      serviceItems: [
        { serviceId: 'svc-1', assignmentStrategy: 'AUTO_ASSIGN' },
      ],
      date: new Date('2026-09-15T10:00:00Z'),
    };

    mockPrisma.service.findMany.mockResolvedValue([
      { id: 'svc-1', name: 'Haircut', durationMinutes: 45, price: 1000, creativeDirectorEligible: false, requiredArtistCount: 1 },
    ]);

    const result = await service.createQuote(request, 'client-1');
    expect(result.advanceRule).toBe('STANDARD_20_PERCENT');
    expect(result.advanceRequired).toBe(200);
  });
});

describe('D8.2 - Server Booking Quote', () => {
  it('should return quote with all required fields', async () => {
    const service = new BookingQuoteService();
    const request: BookingQuoteRequest = {
      serviceItems: [
        { serviceId: 'svc-1', assignmentStrategy: 'AUTO_ASSIGN' },
        { serviceId: 'svc-2', assignmentStrategy: 'AUTO_ASSIGN' },
      ],
      date: new Date('2026-09-15T10:00:00Z'),
      partySize: 2,
    };

    mockPrisma.service.findMany.mockResolvedValue([
      { id: 'svc-1', name: 'Haircut', durationMinutes: 45, price: 1000, creativeDirectorEligible: false, requiredArtistCount: 1 },
      { id: 'svc-2', name: 'Color', durationMinutes: 90, price: 3000, creativeDirectorEligible: false, requiredArtistCount: 1 },
    ]);

    const result = await service.createQuote(request, 'client-1');
    expect(result).toMatchObject({
      quoteId: expect.any(String),
      services: expect.arrayContaining([
        expect.objectContaining({ serviceId: 'svc-1' }),
        expect.objectContaining({ serviceId: 'svc-2' }),
      ]),
      serviceTotal: 4000,
      advanceRule: expect.any(String),
      advanceRequired: expect.any(Number),
      expiresAt: expect.any(Date),
      warnings: expect.any(Array),
    });
  });

  it('should have quote expiry within 15 minutes', async () => {
    const service = new BookingQuoteService();
    const request: BookingQuoteRequest = {
      serviceItems: [
        { serviceId: 'svc-1', assignmentStrategy: 'AUTO_ASSIGN' },
      ],
      date: new Date('2026-09-15T10:00:00Z'),
    };

    mockPrisma.service.findMany.mockResolvedValue([
      { id: 'svc-1', name: 'Haircut', durationMinutes: 45, price: 1000, creativeDirectorEligible: false, requiredArtistCount: 1 },
    ]);

    const before = new Date();
    const result = await service.createQuote(request, 'client-1');
    const after = new Date();

    expect(result.expiresAt.getTime()).toBeGreaterThan(before.getTime());
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after.getTime() + 15 * 60 * 1000);
  });
});