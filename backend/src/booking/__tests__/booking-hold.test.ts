import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BookingHoldService, CreateHoldRequest } from '../booking-hold.service.js';
import { availabilityService } from '../availability.service.js';
import { PrismaClient } from '../generated/prisma/client.js';

// Mock Prisma
vi.mock('../generated/prisma/client.js', () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    bookingQuote: {
      findUnique: vi.fn(),
    },
    bookingHold: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    bookingHoldResource: {
      create: vi.fn(),
    },
    idempotencyKey: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn((cb) => cb({
      bookingHold: {
        create: vi.fn().mockResolvedValue({
          id: 'hold-1',
          status: 'HOLD_ACTIVE',
          expiresAt: new Date(Date.now() + 8 * 60 * 1000),
          totalAdvanceAmount: 200,
          advanceRule: 'STANDARD_20_PERCENT',
        }),
      },
      bookingHoldResource: {
        create: vi.fn().mockResolvedValue({
          id: 'resource-1',
          holdId: 'hold-1',
          artistId: 'artist-1',
          resourceType: 'ARTIST_SLOT',
          startAt: new Date(),
          endAt: new Date(),
        }),
      },
    })),
  })),
}));

describe('D8.4 - Booking Hold Creation', () => {
  let service: BookingHoldService;

  beforeEach(() => {
    service = new BookingHoldService();
  });

  it('should create a hold from a valid quote', async () => {
    const mockPrisma = new PrismaClient();
    mockPrisma.bookingQuote.findUnique.mockResolvedValue({
      id: 'quote-1',
      clientId: 'client-1',
      advanceRequired: 200,
      advanceRule: 'STANDARD_20_PERCENT',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      services: [{ serviceId: 'svc-1', assignmentStrategy: 'AUTO_ASSIGN' }],
    });

    vi.spyOn(availabilityService, 'validateSlotAvailability').mockResolvedValue(true);

    const request: CreateHoldRequest = {
      quoteId: 'quote-1',
      resources: [
        {
          serviceIndex: 0,
          artistId: 'artist-1',
          startAt: new Date('2026-09-15T10:00:00Z'),
          endAt: new Date('2026-09-15T10:45:00Z'),
        },
      ],
      idempotencyKey: 'idemp-1',
    };

    const result = await service.createHold(request, 'client-1');
    expect(result).toMatchObject({
      holdId: expect.any(String),
      status: 'HOLD_ACTIVE',
      expiresAt: expect.any(Date),
      totalAdvanceAmount: 200,
      advanceRule: 'STANDARD_20_PERCENT',
      resources: expect.arrayContaining([
        expect.objectContaining({ artistId: 'artist-1', resourceType: 'ARTIST_SLOT' }),
      ]),
    });
  });

  it('should reject expired quote', async () => {
    const mockPrisma = new PrismaClient();
    mockPrisma.bookingQuote.findUnique.mockResolvedValue({
      id: 'quote-1',
      clientId: 'client-1',
      expiresAt: new Date(Date.now() - 10 * 60 * 1000),
    });

    const request: CreateHoldRequest = {
      quoteId: 'quote-1',
      resources: [{ serviceIndex: 0, startAt: new Date(), endAt: new Date() }],
      idempotencyKey: 'idemp-1',
    };

    await expect(service.createHold(request, 'client-1')).rejects.toThrow('Quote has expired');
  });

  it('should reject quote belonging to different client', async () => {
    const mockPrisma = new PrismaClient();
    mockPrisma.bookingQuote.findUnique.mockResolvedValue({
      id: 'quote-1',
      clientId: 'client-2',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    const request: CreateHoldRequest = {
      quoteId: 'quote-1',
      resources: [{ serviceIndex: 0, startAt: new Date(), endAt: new Date() }],
      idempotencyKey: 'idemp-1',
    };

    await expect(service.createHold(request, 'client-1')).rejects.toThrow('Quote does not belong to this client');
  });

  it('should reject unavailable slot', async () => {
    const mockPrisma = new PrismaClient();
    mockPrisma.bookingQuote.findUnique.mockResolvedValue({
      id: 'quote-1',
      clientId: 'client-1',
      advanceRequired: 200,
      advanceRule: 'STANDARD_20_PERCENT',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      services: [{ serviceId: 'svc-1', assignmentStrategy: 'AUTO_ASSIGN' }],
    });

    vi.spyOn(availabilityService, 'validateSlotAvailability').mockResolvedValue(false);

    const request: CreateHoldRequest = {
      quoteId: 'quote-1',
      resources: [
        {
          serviceIndex: 0,
          artistId: 'artist-1',
          startAt: new Date('2026-09-15T10:00:00Z'),
          endAt: new Date('2026-09-15T10:45:00Z'),
        },
      ],
      idempotencyKey: 'idemp-1',
    };

    await expect(service.createHold(request, 'client-1')).rejects.toThrow('Time slot no longer available');
  });
});

describe('D8.5 - Atomic Availability Recheck', () => {
  it('should recheck availability before creating hold', async () => {
    const service = new BookingHoldService();
    const mockPrisma = new PrismaClient();
    mockPrisma.bookingQuote.findUnique.mockResolvedValue({
      id: 'quote-1',
      clientId: 'client-1',
      advanceRequired: 200,
      advanceRule: 'STANDARD_20_PERCENT',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      services: [{ serviceId: 'svc-1', assignmentStrategy: 'AUTO_ASSIGN' }],
    });

    const validateSpy = vi.spyOn(availabilityService, 'validateSlotAvailability').mockResolvedValue(true);

    const request: CreateHoldRequest = {
      quoteId: 'quote-1',
      resources: [
        {
          serviceIndex: 0,
          artistId: 'artist-1',
          startAt: new Date('2026-09-15T10:00:00Z'),
          endAt: new Date('2026-09-15T10:45:00Z'),
        },
      ],
      idempotencyKey: 'idemp-1',
    };

    await service.createHold(request, 'client-1');
    expect(validateSpy).toHaveBeenCalledWith('artist-1', expect.any(Date), expect.any(Date));
  });

  it('should reject if slot became unavailable', async () => {
    const service = new BookingHoldService();
    const mockPrisma = new PrismaClient();
    mockPrisma.bookingQuote.findUnique.mockResolvedValue({
      id: 'quote-1',
      clientId: 'client-1',
      advanceRequired: 200,
      advanceRule: 'STANDARD_20_PERCENT',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      services: [{ serviceId: 'svc-1', assignmentStrategy: 'AUTO_ASSIGN' }],
    });

    vi.spyOn(availabilityService, 'validateSlotAvailability').mockResolvedValue(false);

    const request: CreateHoldRequest = {
      quoteId: 'quote-1',
      resources: [
        {
          serviceIndex: 0,
          artistId: 'artist-1',
          startAt: new Date('2026-09-15T10:00:00Z'),
          endAt: new Date('2026-09-15T10:45:00Z'),
        },
      ],
      idempotencyKey: 'idemp-1',
    };

    await expect(service.createHold(request, 'client-1')).rejects.toThrow('Time slot no longer available');
  });
});

describe('D8.7 - Exact 8-Minute Hold Expiry', () => {
  it('should set expiresAt to 8 minutes from creation', async () => {
    const service = new BookingHoldService();
    const mockPrisma = new PrismaClient();
    mockPrisma.bookingQuote.findUnique.mockResolvedValue({
      id: 'quote-1',
      clientId: 'client-1',
      advanceRequired: 200,
      advanceRule: 'STANDARD_20_PERCENT',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      services: [{ serviceId: 'svc-1', assignmentStrategy: 'AUTO_ASSIGN' }],
    });

    vi.spyOn(availabilityService, 'validateSlotAvailability').mockResolvedValue(true);

    const now = Date.now();
    const request: CreateHoldRequest = {
      quoteId: 'quote-1',
      resources: [
        {
          serviceIndex: 0,
          artistId: 'artist-1',
          startAt: new Date('2026-09-15T10:00:00Z'),
          endAt: new Date('2026-09-15T10:45:00Z'),
        },
      ],
      idempotencyKey: 'idemp-1',
    };

    const result = await service.createHold(request, 'client-1');
    const expiryTime = result.expiresAt.getTime();
    expect(expiryTime - now).toBeGreaterThanOrEqual(7 * 60 * 1000);
    expect(expiryTime - now).toBeLessThanOrEqual(9 * 60 * 1000);
  });

  it('should recognize expired hold and not block', async () => {
    const service = new BookingHoldService();
    const mockPrisma = new PrismaClient();
    // Simulate expired hold
    mockPrisma.bookingHold.findMany.mockResolvedValue([
      {
        id: 'hold-1',
        status: 'HOLD_ACTIVE',
        expiresAt: new Date(Date.now() - 5 * 60 * 1000),
        clientId: 'client-1',
        resources: [],
      },
    ]);

    await service.cleanupExpiredHolds();
    expect(mockPrisma.bookingHold.update).toHaveBeenCalled();
  });
});

describe('D8.8 - Hold State Machine', () => {
  it('should transition ACTIVE -> RELEASED', async () => {
    const service = new BookingHoldService();
    const mockPrisma = new PrismaClient();
    mockPrisma.bookingHold.findUnique.mockResolvedValue({
      id: 'hold-1',
      clientId: 'client-1',
      status: 'HOLD_ACTIVE',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    await service.releaseHold('hold-1', 'client-1');
    expect(mockPrisma.bookingHold.update).toHaveBeenCalledWith({
      where: { id: 'hold-1' },
      data: { status: 'HOLD_RELEASED', releasedAt: expect.any(Date) },
    });
  });

  it('should reject release of already expired hold', async () => {
    const service = new BookingHoldService();
    const mockPrisma = new PrismaClient();
    mockPrisma.bookingHold.findUnique.mockResolvedValue({
      id: 'hold-1',
      clientId: 'client-1',
      status: 'HOLD_EXPIRED',
      expiresAt: new Date(Date.now() - 5 * 60 * 1000),
    });

    await expect(service.releaseHold('hold-1', 'client-1')).rejects.toThrow('Hold is not active');
  });

  it('should transition ACTIVE -> CONSUMED', async () => {
    const service = new BookingHoldService();
    const mockPrisma = new PrismaClient();
    mockPrisma.bookingHold.findUnique.mockResolvedValue({
      id: 'hold-1',
      clientId: 'client-1',
      status: 'HOLD_ACTIVE',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    await service.consumeHold('hold-1', 'booking-1');
    expect(mockPrisma.bookingHold.update).toHaveBeenCalledWith({
      where: { id: 'hold-1' },
      data: { status: 'HOLD_CONSUMED', consumedAt: expect.any(Date), bookingId: 'booking-1' },
    });
  });
});

describe('D8.9 - Idempotency', () => {
  it('should return cached response for same idempotency key', async () => {
    const service = new BookingHoldService();
    const mockPrisma = new PrismaClient();
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue({
      key: 'idemp-1',
      responseBody: {
        holdId: 'hold-1',
        status: 'HOLD_ACTIVE',
        expiresAt: new Date(),
        totalAdvanceAmount: 200,
        advanceRule: 'STANDARD_20_PERCENT',
        resources: [],
      },
    });

    const request: CreateHoldRequest = {
      quoteId: 'quote-1',
      resources: [{ serviceIndex: 0, startAt: new Date(), endAt: new Date() }],
      idempotencyKey: 'idemp-1',
    };

    const result = await service.createHold(request, 'client-1');
    expect(result.holdId).toBe('hold-1');
  });

  it('should reject changed payload with reused key', async () => {
    const service = new BookingHoldService();
    const mockPrisma = new PrismaClient();
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue({
      key: 'idemp-1',
      responseBody: null,
    });

    const request: CreateHoldRequest = {
      quoteId: 'quote-2',
      resources: [{ serviceIndex: 0, startAt: new Date(), endAt: new Date() }],
      idempotencyKey: 'idemp-1',
    };

    await expect(service.createHold(request, 'client-1')).rejects.toThrow('Idempotency key already used with different request');
  });
});

describe('D8.10 - Hold Read / Release APIs', () => {
  it('should allow owner to read own hold', async () => {
    const service = new BookingHoldService();
    const mockPrisma = new PrismaClient();
    mockPrisma.bookingHold.findUnique.mockResolvedValue({
      id: 'hold-1',
      clientId: 'client-1',
      status: 'HOLD_ACTIVE',
      expiresAt: new Date(),
      resources: [],
    });

    const result = await service.getHold('hold-1', 'client-1');
    expect(result).toBeDefined();
    expect(result.id).toBe('hold-1');
  });

  it('should reject unauthorized access to hold', async () => {
    const service = new BookingHoldService();
    const mockPrisma = new PrismaClient();
    mockPrisma.bookingHold.findUnique.mockResolvedValue({
      id: 'hold-1',
      clientId: 'client-2',
      status: 'HOLD_ACTIVE',
      expiresAt: new Date(),
    });

    await expect(service.getHold('hold-1', 'client-1')).rejects.toThrow('Hold does not belong to this client');
  });

  it('should reject hold not found', async () => {
    const service = new BookingHoldService();
    const mockPrisma = new PrismaClient();
    mockPrisma.bookingHold.findUnique.mockResolvedValue(null);

    await expect(service.getHold('hold-1', 'client-1')).rejects.toThrow('Hold not found');
  });
});