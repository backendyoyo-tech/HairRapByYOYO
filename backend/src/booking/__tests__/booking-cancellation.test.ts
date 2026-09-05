import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Prisma client
const mockPrisma = {
  booking: {
    findUnique: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
  },
  bookingService: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  bookingServiceAssignment: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  bookingHold: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  bookingHoldResource: {
    create: vi.fn(),
  },
  bookingQuote: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  bookingStatusHistory: {
    create: vi.fn(),
  },
  bookingRescheduleHistory: {
    create: vi.fn(),
  },
  artistService: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  artistProfile: {
    findUnique: vi.fn(),
  },
  artistWorkSchedule: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  artistScheduleException: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  service: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  idempotencyKey: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  payment: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
  refund: {
    create: vi.fn(),
  },
  $transaction: vi.fn((cb: any) => cb(mockPrisma)),
};

const mockAvailabilityService = {
  validateSlotAvailability: vi.fn().mockResolvedValue(true),
  searchAvailability: vi.fn().mockResolvedValue([]),
};

// Mock all Prisma entry points
vi.mock('../src/booking/generated/prisma/client.js', () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}));

vi.mock('../src/auth/generated/prisma/client.js', () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}));

vi.mock('../src/shared/generated/prisma/client.js', () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}));

vi.mock('./generated/prisma/client.js', () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}));

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class {
    constructor(config?: any) { this.config = config; }
    query = () => Promise.resolve([]);
    queryRaw = () => Promise.resolve([]);
    executeRaw = () => Promise.resolve(0);
    transaction = (fn: any) => fn(this);
  },
}));

vi.mock('../src/booking/availability.service.js', () => ({
  availabilityService: mockAvailabilityService,
}));

// Import after mocks
import { BookingService } from '../booking.service.js';

describe('BookingService - Cancellation', () => {
  let bookingService: BookingService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockPrisma));
    mockAvailabilityService.validateSlotAvailability.mockResolvedValue(true);
    bookingService = new BookingService();
  });

  const createMockBooking = (overrides = {}) => ({
    id: 'booking-cuid-123',
    clientId: 'client-cuid-123',
    status: 'CONFIRMED',
    version: 1,
    totalPrice: 10000,
    totalAdvanceRequired: 2000,
    advanceRule: 'STANDARD_20_PERCENT',
    advanceTransferCount: 0,
    cancelledAt: null,
    cancelReason: null,
    services: [
      {
        id: 'bs-cuid-1',
        serviceId: 'svc-cuid-1',
        plannedStartAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours from now
        plannedEndAt: new Date(Date.now() + 49 * 60 * 60 * 1000),
        assignmentStatus: 'AWAITING_ASSIGNMENT',
        artistConfirmationState: 'NONE',
        assignments: [],
        requiredArtistCount: 1,
      },
    ],
    payments: [
      {
        id: 'payment-cuid-1',
        purpose: 'ADVANCE',
        status: 'SUCCEEDED',
        amount: 2000,
      },
    ],
    ...overrides,
  });

  const createMockServices = (overrides = {}) => ([
    {
      id: 'svc-cuid-1',
      name: 'Haircut',
      durationMinutes: 60,
      price: 10000,
      creativeDirectorEligible: false,
      requiredArtistCount: 1,
      ...overrides,
    },
  ]);

  it('should cancel booking successfully for client (24+ hours)', async () => {
    const mockBooking = createMockBooking({
      clientId: 'client-cuid-123',
      status: 'CONFIRMED',
      services: [{ ...createMockBooking().services[0], plannedStartAt: new Date(Date.now() + 48 * 60 * 60 * 1000) }],
    });
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
    mockPrisma.booking.update.mockResolvedValue({});
    mockPrisma.bookingStatusHistory.create.mockResolvedValue({});
    mockPrisma.bookingHold.updateMany.mockResolvedValue({});
    mockPrisma.payment.updateMany.mockResolvedValue({});
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue(null);
    mockPrisma.idempotencyKey.create.mockResolvedValue({});

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      reason: 'Client requested cancellation',
      idempotencyKey: 'idem-key-123',
      cancellationType: 'CLIENT',
    };

    const result = await bookingService.cancelBooking(request, 'client-cuid-123', 'CLIENT');

    expect(result.success).toBe(true);
    expect(result.data.status).toBe('CANCELLED');
    expect(result.data.advanceDisposition).toBe('FORFEITED');
    expect(result.data.advanceAmount).toBe(2000);
    expect(result.data.isTimelyCancellation).toBe(true);
    expect(result.data.cancellationType).toBe('CLIENT');
    expect(mockPrisma.booking.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'booking-cuid-123' },
      data: expect.objectContaining({ status: 'CANCELLED', version: { increment: 1 } }),
    }));
    expect(mockPrisma.bookingStatusHistory.create).toHaveBeenCalled();
    expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { bookingId: 'booking-cuid-123', purpose: 'ADVANCE', status: 'SUCCEEDED' },
      data: { metadata: { advanceDisposition: 'FORFEITED', forfeitedAt: expect.any(Date) } },
    }));
  });

  it('should cancel booking successfully for client (<24 hours)', async () => {
    const mockBooking = createMockBooking({
      clientId: 'client-cuid-123',
      status: 'CONFIRMED',
      services: [{ ...createMockBooking().services[0], plannedStartAt: new Date(Date.now() + 12 * 60 * 60 * 1000) }],
    });
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
    mockPrisma.booking.update.mockResolvedValue({});
    mockPrisma.bookingStatusHistory.create.mockResolvedValue({});
    mockPrisma.bookingHold.updateMany.mockResolvedValue({});
    mockPrisma.payment.updateMany.mockResolvedValue({});
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue(null);
    mockPrisma.idempotencyKey.create.mockResolvedValue({});

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      reason: 'Last minute cancellation',
      idempotencyKey: 'idem-key-123',
      cancellationType: 'CLIENT',
    };

    const result = await bookingService.cancelBooking(request, 'client-cuid-123', 'CLIENT');

    expect(result.success).toBe(true);
    expect(result.data.advanceDisposition).toBe('FORFEITED');
    expect(result.data.isTimelyCancellation).toBe(false);
  });

  it('should cancel Creative Director booking (non-refundable)', async () => {
    const mockBooking = createMockBooking({
      clientId: 'client-cuid-123',
      status: 'CONFIRMED',
      totalPrice: 18000,
      totalAdvanceRequired: 5000,
      advanceRule: 'SPECIFIC_CREATIVE_DIRECTOR_FIXED',
      services: [{ ...createMockBooking().services[0], plannedStartAt: new Date(Date.now() + 48 * 60 * 60 * 1000) }],
      payments: [{ id: 'payment-cuid-1', purpose: 'ADVANCE', status: 'SUCCEEDED', amount: 5000 }],
    });
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
    mockPrisma.booking.update.mockResolvedValue({});
    mockPrisma.bookingStatusHistory.create.mockResolvedValue({});
    mockPrisma.bookingHold.updateMany.mockResolvedValue({});
    mockPrisma.payment.updateMany.mockResolvedValue({});
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue(null);
    mockPrisma.idempotencyKey.create.mockResolvedValue({});

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      reason: 'Client cancelled Creative Director booking',
      idempotencyKey: 'idem-key-123',
      cancellationType: 'CLIENT',
    };

    const result = await bookingService.cancelBooking(request, 'client-cuid-123', 'CLIENT');

    expect(result.success).toBe(true);
    expect(result.data.advanceDisposition).toBe('FORFEITED');
    expect(result.data.advanceRule).toBe('SPECIFIC_CREATIVE_DIRECTOR_FIXED');
    expect(result.data.advanceAmount).toBe(5000);
  });

  it('should allow staff to cancel any booking (YOYO cancellation)', async () => {
    const mockBooking = createMockBooking({
      clientId: 'other-client-cuid',
      status: 'CONFIRMED',
      services: [{ ...createMockBooking().services[0], plannedStartAt: new Date(Date.now() + 48 * 60 * 60 * 1000) }],
    });
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
    mockPrisma.booking.update.mockResolvedValue({});
    mockPrisma.bookingStatusHistory.create.mockResolvedValue({});
    mockPrisma.bookingHold.updateMany.mockResolvedValue({});
    mockPrisma.refund.create.mockResolvedValue({});
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue(null);
    mockPrisma.idempotencyKey.create.mockResolvedValue({});

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      reason: 'YOYO operational cancellation',
      idempotencyKey: 'idem-key-123',
      cancellationType: 'YOYO',
    };

    const result = await bookingService.cancelBooking(request, 'staff-cuid-123', 'STAFF');

    expect(result.success).toBe(true);
    expect(result.data.advanceDisposition).toBe('REFUND_PENDING');
    expect(result.data.cancellationType).toBe('YOYO');
    expect(result.data.refundAmount).toBe(2000);
    expect(mockPrisma.refund.create).toHaveBeenCalled();
  });

  it('should reject cancellation for non-owner client', async () => {
    const mockBooking = createMockBooking({ clientId: 'other-client-cuid' });
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      reason: 'Unauthorized',
      idempotencyKey: 'idem-key-123',
      cancellationType: 'CLIENT',
    };

    await expect(bookingService.cancelBooking(request, 'client-cuid-123', 'CLIENT'))
      .rejects.toThrow('FORBIDDEN');
  });

  it('should reject cancellation for invalid booking state', async () => {
    const mockBooking = createMockBooking({ status: 'CANCELLED' });
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      reason: 'Test',
      idempotencyKey: 'idem-key-123',
      cancellationType: 'CLIENT',
    };

    await expect(bookingService.cancelBooking(request, 'client-cuid-123', 'CLIENT'))
      .rejects.toThrow('INVALID_STATE_TRANSITION');
  });

  it('should reject cancellation with version conflict', async () => {
    const mockBooking = createMockBooking({ version: 2 });
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      reason: 'Test',
      idempotencyKey: 'idem-key-123',
      cancellationType: 'CLIENT',
    };

    await expect(bookingService.cancelBooking(request, 'client-cuid-123', 'CLIENT'))
      .rejects.toThrow('VERSION_CONFLICT');
  });

  it('should reject cancellation for NO_SHOW booking', async () => {
    const mockBooking = createMockBooking({ status: 'NO_SHOW' });
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      reason: 'Test',
      idempotencyKey: 'idem-key-123',
      cancellationType: 'CLIENT',
    };

    await expect(bookingService.cancelBooking(request, 'client-cuid-123', 'CLIENT'))
      .rejects.toThrow('INVALID_STATE_TRANSITION');
  });

  it('should reject cancellation for IN_SERVICE booking', async () => {
    const mockBooking = createMockBooking({ status: 'IN_SERVICE' });
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      reason: 'Test',
      idempotencyKey: 'idem-key-123',
      cancellationType: 'CLIENT',
    };

    await expect(bookingService.cancelBooking(request, 'client-cuid-123', 'CLIENT'))
      .rejects.toThrow('INVALID_STATE_TRANSITION');
  });

  it('should handle idempotent duplicate request', async () => {
    const mockBooking = createMockBooking();
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
    mockPrisma.booking.update.mockResolvedValue({});
    mockPrisma.bookingStatusHistory.create.mockResolvedValue({});
    mockPrisma.bookingHold.updateMany.mockResolvedValue({});
    mockPrisma.payment.updateMany.mockResolvedValue({});

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      reason: 'Test',
      idempotencyKey: 'idem-key-123',
      cancellationType: 'CLIENT',
    };

    mockPrisma.idempotencyKey.findUnique.mockResolvedValueOnce(null);
    mockPrisma.idempotencyKey.create.mockResolvedValue({});

    await bookingService.cancelBooking(request, 'client-cuid-123', 'CLIENT');

    mockPrisma.idempotencyKey.findUnique.mockResolvedValueOnce({
      responseBody: { success: true, data: { bookingId: 'booking-cuid-123' } },
    });

    const result2 = await bookingService.cancelBooking(request, 'client-cuid-123', 'CLIENT');
    expect(result2.success).toBe(true);
  });

  it('should reject idempotency key reuse with different payload', async () => {
    const mockBooking = createMockBooking();
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);

    mockPrisma.idempotencyKey.findUnique.mockResolvedValueOnce({
      responseBody: { success: true, data: { bookingId: 'booking-cuid-123' } },
    });

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      reason: 'Different payload',
      idempotencyKey: 'idem-key-123',
      cancellationType: 'CLIENT',
    };

    await expect(bookingService.cancelBooking(request, 'client-cuid-123', 'CLIENT'))
      .rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });

  it('should reject if no future service found', async () => {
    const mockBooking = createMockBooking({
      services: [{
        ...createMockBooking().services[0],
        plannedStartAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Past
      }],
    });
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      reason: 'Test',
      idempotencyKey: 'idem-key-123',
      cancellationType: 'CLIENT',
    };

    await expect(bookingService.cancelBooking(request, 'client-cuid-123', 'CLIENT'))
      .rejects.toThrow('INVALID_STATE_TRANSITION');
  });
});