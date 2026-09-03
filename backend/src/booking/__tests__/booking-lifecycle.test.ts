import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BookingService } from '../booking.service.js';
import { availabilityService } from '../availability.service.js';

// Mock Prisma
const mockPrisma = {
  booking: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  bookingService: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  bookingStatusHistory: {
    create: vi.fn(),
  },
  bookingHold: {
    updateMany: vi.fn(),
  },
  idempotencyKey: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn((cb) => cb(mockPrisma)),
};

// Mock the Prisma client module
vi.mock('../generated/prisma/client.js', () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}));

// Mock availability service
vi.mock('../availability.service.js', () => ({
  availabilityService: {
    validateSlotAvailability: vi.fn().mockResolvedValue(true),
  },
}));

describe('D10 - Booking Lifecycle Commands', () => {
  let service: BookingService;

  beforeEach(() => {
    service = new BookingService();
    vi.clearAllMocks();
  });

  describe('checkInBooking', () => {
    it('should successfully check in a CONFIRMED booking', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'booking-1',
        status: 'CONFIRMED',
        checkedInAt: null,
        version: 1,
      });

      const result = await service.checkInBooking('booking-1', 'staff-1', 'Client arrived');

      expect(result).toMatchObject({
        success: true,
        status: 'CHECKED_IN',
      });
      expect(mockPrisma.booking.update).toHaveBeenCalledWith({
        where: { id: 'booking-1' },
        data: {
          status: 'CHECKED_IN',
          checkedInAt: expect.any(Date),
          version: { increment: 1 },
        },
      });
      expect(mockPrisma.bookingStatusHistory.create).toHaveBeenCalledWith({
        data: {
          bookingId: 'booking-1',
          fromStatus: 'CONFIRMED',
          toStatus: 'CHECKED_IN',
          actorType: 'STAFF',
          actorId: 'staff-1',
          reason: 'Client arrived',
        },
      });
    });

    it('should be idempotent on duplicate check-in', async () => {
      const checkedInAt = new Date('2026-09-15T10:00:00Z');
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'booking-1',
        status: 'CHECKED_IN',
        checkedInAt,
        version: 2,
      });

      const result = await service.checkInBooking('booking-1', 'staff-1', 'Duplicate check-in');

      expect(result).toMatchObject({
        success: true,
        status: 'CHECKED_IN',
        alreadyCheckedIn: true,
        checkedInAt,
      });
      expect(mockPrisma.booking.update).not.toHaveBeenCalled();
    });

    it('should reject check-in for non-CONFIRMED booking', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'booking-1',
        status: 'CANCELLED',
        checkedInAt: null,
      });

      await expect(service.checkInBooking('booking-1', 'staff-1')).rejects.toThrow('INVALID_STATE_TRANSITION');
    });

    it('should reject check-in for already checked-in booking with error (old behavior)', async () => {
      // This test documents the old behavior - now it should be idempotent
      const checkedInAt = new Date();
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'booking-1',
        status: 'CHECKED_IN',
        checkedInAt,
      });

      const result = await service.checkInBooking('booking-1', 'staff-1');
      expect(result.alreadyCheckedIn).toBe(true);
    });
  });

  describe('markNoShow', () => {
    it('should successfully mark CONFIRMED booking as no-show after appointment time', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'booking-1',
        status: 'CONFIRMED',
        version: 1,
      });

      // No upcoming services (all in the past)
      mockPrisma.bookingService.findFirst.mockResolvedValue(null);

      const result = await service.markNoShow('booking-1', 'staff-1', 'No-show');

      expect(result).toMatchObject({ success: true, status: 'NO_SHOW' });
      expect(mockPrisma.booking.update).toHaveBeenCalledWith({
        where: { id: 'booking-1' },
        data: {
          status: 'NO_SHOW',
          cancelledAt: expect.any(Date),
          cancelReason: 'No-show',
          version: { increment: 1 },
        },
      });
    });

    it('should reject no-show for CHECKED_IN booking', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'booking-1',
        status: 'CHECKED_IN',
        version: 2,
      });

      await expect(service.markNoShow('booking-1', 'staff-1')).rejects.toThrow('INVALID_STATE_TRANSITION');
    });

    it('should reject no-show before appointment time', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'booking-1',
        status: 'CONFIRMED',
        version: 1,
      });

      // Upcoming service exists
      mockPrisma.bookingService.findFirst.mockResolvedValue({
        id: 'service-1',
        bookingId: 'booking-1',
        plannedStartAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour in future
      });

      await expect(service.markNoShow('booking-1', 'staff-1')).rejects.toThrow('NO_SHOW_TOO_EARLY');
    });

    it('should reject no-show for non-CONFIRMED states', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'booking-1',
        status: 'CANCELLED',
        version: 1,
      });

      await expect(service.markNoShow('booking-1', 'staff-1')).rejects.toThrow('INVALID_STATE_TRANSITION');
    });
  });

  describe('cancelBooking', () => {
    it('should successfully cancel CONFIRMED booking', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'booking-1',
        clientId: 'client-1',
        status: 'CONFIRMED',
        version: 1,
      });

      // No upcoming services within 2 hours
      mockPrisma.bookingService.findFirst.mockResolvedValue({
        id: 'service-1',
        plannedStartAt: new Date(Date.now() + 3 * 60 * 60 * 1000), // 3 hours in future
      });

      const result = await service.cancelBooking('booking-1', 'client-1', 'Changed plans');

      expect(result).toMatchObject({ success: true, status: 'CANCELLED' });
      expect(mockPrisma.booking.update).toHaveBeenCalledWith({
        where: { id: 'booking-1' },
        data: {
          status: 'CANCELLED',
          cancelledAt: expect.any(Date),
          cancelReason: 'Changed plans',
          version: { increment: 1 },
        },
      });
    });

    it('should reject cancellation within 2 hours of service', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'booking-1',
        clientId: 'client-1',
        status: 'CONFIRMED',
        version: 1,
      });

      mockPrisma.bookingService.findFirst.mockResolvedValue({
        id: 'service-1',
        plannedStartAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour in future
      });

      await expect(service.cancelBooking('booking-1', 'client-1', 'Too late')).rejects.toThrow('CANCELLATION_POLICY');
    });

    it('should reject cancellation by non-owner', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'booking-1',
        clientId: 'client-2',
        status: 'CONFIRMED',
      });

      await expect(service.cancelBooking('booking-1', 'client-1', 'Not owner')).rejects.toThrow('FORBIDDEN');
    });

    it('should reject cancellation from invalid state', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 'booking-1',
        clientId: 'client-1',
        status: 'NO_SHOW',
        version: 1,
      });

      await expect(service.cancelBooking('booking-1', 'client-1', 'Test')).rejects.toThrow('INVALID_STATE_TRANSITION');
    });
  });
});