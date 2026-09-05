import { describe, it, expect, beforeEach, vi } from 'vitest';

// Import mocks from vitest.setup.ts (they're hoisted and available before any imports)
import { mockPrisma, mockAvailabilityService } from './vitest.setup.js';

// Now import after mocks are set up
import { BookingService } from '../booking.service.js';

describe('BookingService - Reschedule', () => {
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
    services: [
      {
        id: 'bs-cuid-1',
        serviceId: 'svc-cuid-1',
        plannedStartAt: new Date('2026-09-20T10:00:00Z'),
        plannedEndAt: new Date('2026-09-20T11:00:00Z'),
        assignmentStatus: 'AWAITING_ASSIGNMENT',
        artistConfirmationState: 'NONE',
        assignments: [],
        requiredArtistCount: 1,
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

  it('should reschedule booking with new service times', async () => {
    const mockBooking = createMockBooking();
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
    mockPrisma.service.findMany.mockResolvedValue(createMockServices());
    mockPrisma.bookingService.create.mockResolvedValue({});
    mockPrisma.bookingService.deleteMany.mockResolvedValue({});
    mockPrisma.booking.update.mockResolvedValue({});
    mockPrisma.bookingRescheduleHistory.create.mockResolvedValue({});
    mockPrisma.bookingStatusHistory.create.mockResolvedValue({});
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue(null);
    mockPrisma.idempotencyKey.create.mockResolvedValue({});

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      newServices: [
        {
          serviceId: 'svc-cuid-1',
          startAt: new Date('2026-09-20T14:00:00Z'),
          endAt: new Date('2026-09-20T15:00:00Z'),
          bufferMinutes: 10,
        },
      ],
      reason: 'Client requested later time',
      idempotencyKey: 'idem-key-123',
    };

    const result = await bookingService.rescheduleBooking(request, 'client-cuid-123', 'CLIENT');

    expect(result.success).toBe(true);
    expect(result.data.totalPrice).toBe(10000);
    expect(mockPrisma.bookingService.create).toHaveBeenCalled();
    expect(mockPrisma.bookingService.deleteMany).toHaveBeenCalledWith({ where: { bookingId: 'booking-cuid-123' } });
    expect(mockPrisma.booking.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'booking-cuid-123' },
      data: expect.objectContaining({ version: { increment: 1 } }),
    }));
  });

  it('should reject reschedule for non-CONFIRMED/CHECKED_IN booking', async () => {
    const mockBooking = createMockBooking({ status: 'CANCELLED' });
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      newServices: [{ serviceId: 'svc-cuid-1', startAt: new Date('2026-09-20T14:00:00Z'), endAt: new Date('2026-09-20T15:00:00Z') }],
      reason: 'Test',
      idempotencyKey: 'idem-key-123',
    };

    await expect(bookingService.rescheduleBooking(request, 'client-cuid-123', 'CLIENT'))
      .rejects.toThrow('INVALID_STATE_TRANSITION');
  });

  it('should reject reschedule with version conflict', async () => {
    const mockBooking = createMockBooking({ version: 2 });
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      newServices: [{ serviceId: 'svc-cuid-1', startAt: new Date('2026-09-20T14:00:00Z'), endAt: new Date('2026-09-20T15:00:00Z') }],
      reason: 'Test',
      idempotencyKey: 'idem-key-123',
    };

    await expect(bookingService.rescheduleBooking(request, 'client-cuid-123', 'CLIENT'))
      .rejects.toThrow('VERSION_CONFLICT');
  });

  it('should reject reschedule when slot unavailable', async () => {
    const mockBooking = createMockBooking();
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
    mockPrisma.service.findMany.mockResolvedValue(createMockServices());
    mockAvailabilityService.validateSlotAvailability.mockResolvedValue(false);

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      newServices: [{ serviceId: 'svc-cuid-1', startAt: new Date('2026-09-20T14:00:00Z'), endAt: new Date('2026-09-20T15:00:00Z') }],
      reason: 'Test',
      idempotencyKey: 'idem-key-123',
    };

    await expect(bookingService.rescheduleBooking(request, 'client-cuid-123', 'CLIENT'))
      .rejects.toThrow('SLOT_UNAVAILABLE');
  });

  it('should apply standard 20% advance transfer for timely reschedule (24+ hours)', async () => {
    const mockBooking = createMockBooking({
      totalPrice: 10000,
      totalAdvanceRequired: 2000,
      services: [{ ...createMockBooking().services[0], plannedStartAt: new Date(Date.now() + 48 * 60 * 60 * 1000) }],
    });
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
    mockPrisma.service.findMany.mockResolvedValue(createMockServices());
    mockAvailabilityService.validateSlotAvailability.mockResolvedValue(true);
    mockPrisma.bookingService.create.mockResolvedValue({});
    mockPrisma.bookingService.deleteMany.mockResolvedValue({});
    mockPrisma.booking.update.mockResolvedValue({});
    mockPrisma.bookingRescheduleHistory.create.mockResolvedValue({});
    mockPrisma.bookingStatusHistory.create.mockResolvedValue({});
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue(null);
    mockPrisma.idempotencyKey.create.mockResolvedValue({});

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      newServices: [{ serviceId: 'svc-cuid-1', startAt: new Date(Date.now() + 48 * 60 * 60 * 1000), endAt: new Date(Date.now() + 49 * 60 * 60 * 1000) }],
      reason: 'Client requested later time',
      idempotencyKey: 'idem-key-123',
    };

    const result = await bookingService.rescheduleBooking(request, 'client-cuid-123', 'CLIENT');

    expect(result.success).toBe(true);
    expect(result.data.advanceTransferApplied).toBe(true);
    expect(result.data.advanceTransferAmount).toBe(2000);
    expect(mockPrisma.booking.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ advanceTransferCount: { increment: 1 } }),
    }));
  });

  it('should NOT apply advance transfer if already transferred once', async () => {
    const mockBooking = createMockBooking({
      totalPrice: 10000,
      totalAdvanceRequired: 2000,
      advanceTransferCount: 1,
      services: [{ ...createMockBooking().services[0], plannedStartAt: new Date(Date.now() + 48 * 60 * 60 * 1000) }],
    });
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
    mockPrisma.service.findMany.mockResolvedValue(createMockServices());
    mockAvailabilityService.validateSlotAvailability.mockResolvedValue(true);
    mockPrisma.bookingService.create.mockResolvedValue({});
    mockPrisma.bookingService.deleteMany.mockResolvedValue({});
    mockPrisma.booking.update.mockResolvedValue({});
    mockPrisma.bookingRescheduleHistory.create.mockResolvedValue({});
    mockPrisma.bookingStatusHistory.create.mockResolvedValue({});
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue(null);
    mockPrisma.idempotencyKey.create.mockResolvedValue({});

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      newServices: [{ serviceId: 'svc-cuid-1', startAt: new Date(Date.now() + 48 * 60 * 60 * 1000), endAt: new Date(Date.now() + 49 * 60 * 60 * 1000) }],
      reason: 'Second reschedule',
      idempotencyKey: 'idem-key-123',
    };

    const result = await bookingService.rescheduleBooking(request, 'client-cuid-123', 'CLIENT');

    expect(result.success).toBe(true);
    expect(result.data.advanceTransferApplied).toBe(false);
    expect(result.data.advanceTransferAmount).toBe(0);
  });

  it('should apply Creative Director ₹5,000 advance transfer for timely reschedule', async () => {
    const mockBooking = createMockBooking({
      totalPrice: 18000,
      totalAdvanceRequired: 5000,
      advanceRule: 'SPECIFIC_CREATIVE_DIRECTOR_FIXED',
      services: [{ ...createMockBooking().services[0], plannedStartAt: new Date(Date.now() + 48 * 60 * 60 * 1000) }],
    });
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
    mockPrisma.service.findMany.mockResolvedValue(createMockServices({ creativeDirectorEligible: true, price: 18000 }));
    mockAvailabilityService.validateSlotAvailability.mockResolvedValue(true);
    mockPrisma.bookingService.create.mockResolvedValue({});
    mockPrisma.bookingService.deleteMany.mockResolvedValue({});
    mockPrisma.booking.update.mockResolvedValue({});
    mockPrisma.bookingRescheduleHistory.create.mockResolvedValue({});
    mockPrisma.bookingStatusHistory.create.mockResolvedValue({});
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue(null);
    mockPrisma.idempotencyKey.create.mockResolvedValue({});

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      newServices: [
        { serviceId: 'svc-cuid-1', artistId: 'artist-cuid-1', startAt: new Date(Date.now() + 48 * 60 * 60 * 1000), endAt: new Date(Date.now() + 49 * 60 * 60 * 1000) },
      ],
      reason: 'Client requested later time',
      idempotencyKey: 'idem-key-123',
    };

    const result = await bookingService.rescheduleBooking(request, 'client-cuid-123', 'CLIENT');

    expect(result.success).toBe(true);
    expect(result.data.advanceTransferApplied).toBe(true);
    expect(result.data.advanceTransferAmount).toBe(5000);
  });

  it('should recalculate provisional/final state when crossing 30-day boundary', async () => {
    const mockBooking = createMockBooking({
      services: [{ ...createMockBooking().services[0], plannedStartAt: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000) }],
    });
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
    mockPrisma.service.findMany.mockResolvedValue(createMockServices());
    mockAvailabilityService.validateSlotAvailability.mockResolvedValue(true);
    mockPrisma.bookingService.create.mockResolvedValue({});
    mockPrisma.bookingService.deleteMany.mockResolvedValue({});
    mockPrisma.booking.update.mockResolvedValue({});
    mockPrisma.bookingRescheduleHistory.create.mockResolvedValue({});
    mockPrisma.bookingStatusHistory.create.mockResolvedValue({});
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue(null);
    mockPrisma.idempotencyKey.create.mockResolvedValue({});

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      newServices: [
        { serviceId: 'svc-cuid-1', artistId: 'artist-cuid-1', startAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), endAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000) },
      ],
      reason: 'Move earlier',
      idempotencyKey: 'idem-key-123',
    };

    await bookingService.rescheduleBooking(request, 'client-cuid-123', 'CLIENT');

    const createCall = mockPrisma.bookingService.create.mock.calls[0][0];
    expect(createCall.data.artistConfirmationState).toBe('FINAL');
  });

  it('should reject reschedule within 24 hours (no advance transfer)', async () => {
    const mockBooking = createMockBooking({
      totalPrice: 10000,
      totalAdvanceRequired: 2000,
      services: [{ ...createMockBooking().services[0], plannedStartAt: new Date(Date.now() + 12 * 60 * 60 * 1000) }],
    });
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
    mockPrisma.service.findMany.mockResolvedValue(createMockServices());
    mockAvailabilityService.validateSlotAvailability.mockResolvedValue(true);
    mockPrisma.bookingService.create.mockResolvedValue({});
    mockPrisma.bookingService.deleteMany.mockResolvedValue({});
    mockPrisma.booking.update.mockResolvedValue({});
    mockPrisma.bookingRescheduleHistory.create.mockResolvedValue({});
    mockPrisma.bookingStatusHistory.create.mockResolvedValue({});
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue(null);
    mockPrisma.idempotencyKey.create.mockResolvedValue({});

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      newServices: [{ serviceId: 'svc-cuid-1', startAt: new Date(Date.now() + 12 * 60 * 60 * 1000), endAt: new Date(Date.now() + 13 * 60 * 60 * 1000) }],
      reason: 'Urgent reschedule',
      idempotencyKey: 'idem-key-123',
    };

    const result = await bookingService.rescheduleBooking(request, 'client-cuid-123', 'CLIENT');

    expect(result.success).toBe(true);
    expect(result.data.advanceTransferApplied).toBe(false);
    expect(result.data.advanceTransferAmount).toBe(0);
  });

  it('should handle idempotent duplicate request', async () => {
    const mockBooking = createMockBooking();
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
    mockPrisma.service.findMany.mockResolvedValue(createMockServices());
    mockAvailabilityService.validateSlotAvailability.mockResolvedValue(true);
    mockPrisma.bookingService.create.mockResolvedValue({});
    mockPrisma.bookingService.deleteMany.mockResolvedValue({});
    mockPrisma.booking.update.mockResolvedValue({});
    mockPrisma.bookingRescheduleHistory.create.mockResolvedValue({});
    mockPrisma.bookingStatusHistory.create.mockResolvedValue({});

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      newServices: [{ serviceId: 'svc-cuid-1', startAt: new Date('2026-09-20T14:00:00Z'), endAt: new Date('2026-09-20T15:00:00Z') }],
      reason: 'Test',
      idempotencyKey: 'idem-key-123',
    };

    mockPrisma.idempotencyKey.findUnique.mockResolvedValueOnce(null);
    mockPrisma.idempotencyKey.create.mockResolvedValue({});

    await bookingService.rescheduleBooking(request, 'client-cuid-123', 'CLIENT');

    mockPrisma.idempotencyKey.findUnique.mockResolvedValueOnce({
      responseBody: { success: true, data: { bookingId: 'booking-cuid-123' } },
    });

    const result2 = await bookingService.rescheduleBooking(request, 'client-cuid-123', 'CLIENT');
    expect(result2.success).toBe(true);
  });

  it('should reject when trying to reuse idempotency key with different payload', async () => {
    const mockBooking = createMockBooking();
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);

    mockPrisma.idempotencyKey.findUnique.mockResolvedValueOnce({
      responseBody: { success: true, data: { bookingId: 'booking-cuid-123' } },
    });

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      newServices: [{ serviceId: 'svc-cuid-1', startAt: new Date('2026-09-20T14:00:00Z'), endAt: new Date('2026-09-20T15:00:00Z') }],
      reason: 'Different payload',
      idempotencyKey: 'idem-key-123',
    };

    await expect(bookingService.rescheduleBooking(request, 'client-cuid-123', 'CLIENT'))
      .rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });

  it('should allow staff to reschedule any booking', async () => {
    const mockBooking = createMockBooking({ clientId: 'other-client-cuid' });
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);
    mockPrisma.service.findMany.mockResolvedValue(createMockServices());
    mockAvailabilityService.validateSlotAvailability.mockResolvedValue(true);
    mockPrisma.bookingService.create.mockResolvedValue({});
    mockPrisma.bookingService.deleteMany.mockResolvedValue({});
    mockPrisma.booking.update.mockResolvedValue({});
    mockPrisma.bookingRescheduleHistory.create.mockResolvedValue({});
    mockPrisma.bookingStatusHistory.create.mockResolvedValue({});
    mockPrisma.idempotencyKey.findUnique.mockResolvedValue(null);
    mockPrisma.idempotencyKey.create.mockResolvedValue({});

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      newServices: [{ serviceId: 'svc-cuid-1', startAt: new Date('2026-09-20T14:00:00Z'), endAt: new Date('2026-09-20T15:00:00Z') }],
      reason: 'Staff reschedule',
      idempotencyKey: 'idem-key-123',
    };

    const result = await bookingService.rescheduleBooking(request, 'staff-cuid-123', 'STAFF');
    expect(result.success).toBe(true);
  });

  it('should reject non-owner client from rescheduling', async () => {
    const mockBooking = createMockBooking({ clientId: 'other-client-cuid' });
    mockPrisma.booking.findUnique.mockResolvedValue(mockBooking);

    const request = {
      bookingId: 'booking-cuid-123',
      expectedVersion: 1,
      newServices: [{ serviceId: 'svc-cuid-1', startAt: new Date('2026-09-20T14:00:00Z'), endAt: new Date('2026-09-20T15:00:00Z') }],
      reason: 'Unauthorized',
      idempotencyKey: 'idem-key-123',
    };

    await expect(bookingService.rescheduleBooking(request, 'client-cuid-123', 'CLIENT'))
      .rejects.toThrow('FORBIDDEN');
  });
});