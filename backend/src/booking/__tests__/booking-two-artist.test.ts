import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BookingService, AssignArtistRequest } from '../booking.service.js';
import { availabilityService } from '../availability.service.js';

// Mock Prisma
const mockPrisma = {
  bookingService: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  bookingServiceAssignment: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
  },
  artistService: {
    findFirst: vi.fn(),
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

describe('D12 - Generic Required-Artist-Count=2 Assignment & Capacity Rules', () => {
  let service: BookingService;

  beforeEach(() => {
    service = new BookingService();
    vi.clearAllMocks();
  });

  describe('requiredArtistCount configuration', () => {
    it('should use service.requiredArtistCount as configuration', async () => {
      const bookingService = {
        id: 'bs-1',
        bookingId: 'booking-1',
        serviceId: 'svc-1',
        service: { id: 'svc-1', requiredArtistCount: 2 },
        requestedArtistId: null,
        plannedStartAt: new Date('2026-09-15T10:00:00Z'),
        plannedEndAt: new Date('2026-09-15T10:45:00Z'),
        assignmentStrategy: 'AUTO_ASSIGN',
        assignments: [],
      };

      mockPrisma.bookingService.findUnique.mockResolvedValue({ ...bookingService, assignments: [] });
      mockPrisma.artistService.findFirst.mockResolvedValue({ id: 'as-1' });
      mockPrisma.bookingServiceAssignment.findFirst.mockResolvedValue(null);
      mockPrisma.bookingServiceAssignment.findMany.mockResolvedValue([]);
      mockPrisma.bookingServiceAssignment.create.mockResolvedValue({
        id: 'assign-1',
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'LEAD',
        assignmentSource: 'FLOOR_MANAGER',
        status: 'CONFIRMED',
      });

      const request: AssignArtistRequest = {
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'PRIMARY', // Will be converted to LEAD for 2-artist
        assignmentSource: 'FLOOR_MANAGER',
        assignedByStaffId: 'staff-1',
      };

      const result = await service.assignArtist(request, 'staff-1');
      expect(result.role).toBe('LEAD');
    });

    it('should require two distinct artists for requiredArtistCount=2', async () => {
      // First assignment
      mockPrisma.bookingService.findUnique.mockResolvedValue({
        id: 'bs-1',
        bookingId: 'booking-1',
        serviceId: 'svc-1',
        service: { id: 'svc-1', requiredArtistCount: 2 },
        requestedArtistId: null,
        plannedStartAt: new Date('2026-09-15T10:00:00Z'),
        plannedEndAt: new Date('2026-09-15T10:45:00Z'),
        assignmentStrategy: 'AUTO_ASSIGN',
        assignments: [],
      });
      mockPrisma.artistService.findFirst.mockResolvedValue({ id: 'as-1' });
      mockPrisma.bookingServiceAssignment.findFirst.mockResolvedValue(null);
      mockPrisma.bookingServiceAssignment.findMany.mockResolvedValue([]);
      mockPrisma.bookingServiceAssignment.create.mockResolvedValue({
        id: 'assign-1',
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'LEAD',
        assignmentSource: 'FLOOR_MANAGER',
        status: 'CONFIRMED',
      });

      const firstRequest: AssignArtistRequest = {
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'LEAD',
        assignmentSource: 'FLOOR_MANAGER',
        assignedByStaffId: 'staff-1',
      };

      const firstResult = await service.assignArtist(firstRequest, 'staff-1');
      expect(firstResult.role).toBe('LEAD');

      // Second assignment should be required for FULLY_ASSIGNED
      mockPrisma.bookingService.findUnique.mockResolvedValue({
        id: 'bs-1',
        bookingId: 'booking-1',
        serviceId: 'svc-1',
        service: { id: 'svc-1', requiredArtistCount: 2 },
        requestedArtistId: null,
        plannedStartAt: new Date('2026-09-15T10:00:00Z'),
        plannedEndAt: new Date('2026-09-15T10:45:00Z'),
        assignmentStrategy: 'AUTO_ASSIGN',
        assignments: [{ artistId: 'artist-1', role: 'LEAD', status: 'CONFIRMED' }],
      });
      mockPrisma.bookingServiceAssignment.findFirst.mockResolvedValue(null);
      mockPrisma.bookingServiceAssignment.findMany.mockResolvedValue([{ role: 'LEAD' }]);
      mockPrisma.bookingServiceAssignment.create.mockResolvedValue({
        id: 'assign-2',
        bookingServiceId: 'bs-1',
        artistId: 'artist-2',
        role: 'SUPPORT',
        assignmentSource: 'FLOOR_MANAGER',
        status: 'CONFIRMED',
      });

      const secondRequest: AssignArtistRequest = {
        bookingServiceId: 'bs-1',
        artistId: 'artist-2',
        role: 'SUPPORT',
        assignmentSource: 'FLOOR_MANAGER',
        assignedByStaffId: 'staff-1',
      };

      const secondResult = await service.assignArtist(secondRequest, 'staff-1');
      expect(secondResult.role).toBe('SUPPORT');
    });

    it('should reject same artist for both LEAD and SUPPORT', async () => {
      mockPrisma.bookingService.findUnique.mockResolvedValue({
        id: 'bs-1',
        bookingId: 'booking-1',
        serviceId: 'svc-1',
        service: { id: 'svc-1', requiredArtistCount: 2 },
        requestedArtistId: null,
        plannedStartAt: new Date('2026-09-15T10:00:00Z'),
        plannedEndAt: new Date('2026-09-15T10:45:00Z'),
        assignmentStrategy: 'AUTO_ASSIGN',
        assignments: [{ artistId: 'artist-1', role: 'LEAD', status: 'CONFIRMED' }],
      });
      mockPrisma.artistService.findFirst.mockResolvedValue({ id: 'as-1' });

      const request: AssignArtistRequest = {
        bookingServiceId: 'bs-1',
        artistId: 'artist-1', // Same artist
        role: 'SUPPORT',
        assignmentSource: 'FLOOR_MANAGER',
        assignedByStaffId: 'staff-1',
      };

      await expect(service.assignArtist(request, 'staff-1')).rejects.toThrow('DUPLICATE_ARTIST');
    });

    it('should reject duplicate LEAD role', async () => {
      mockPrisma.bookingService.findUnique.mockResolvedValue({
        id: 'bs-1',
        bookingId: 'booking-1',
        serviceId: 'svc-1',
        service: { id: 'svc-1', requiredArtistCount: 2 },
        requestedArtistId: null,
        plannedStartAt: new Date('2026-09-15T10:00:00Z'),
        plannedEndAt: new Date('2026-09-15T10:45:00Z'),
        assignmentStrategy: 'AUTO_ASSIGN',
        assignments: [{ artistId: 'artist-1', role: 'LEAD', status: 'CONFIRMED' }],
      });
      mockPrisma.artistService.findFirst.mockResolvedValue({ id: 'as-1' });
      mockPrisma.bookingServiceAssignment.findMany.mockResolvedValue([{ role: 'LEAD' }]);

      const request: AssignArtistRequest = {
        bookingServiceId: 'bs-1',
        artistId: 'artist-2',
        role: 'LEAD', // Duplicate LEAD
        assignmentSource: 'FLOOR_MANAGER',
        assignedByStaffId: 'staff-1',
      };

      await expect(service.assignArtist(request, 'staff-1')).rejects.toThrow('DUPLICATE_ROLE');
    });

    it('should reject duplicate SUPPORT role', async () => {
      mockPrisma.bookingService.findUnique.mockResolvedValue({
        id: 'bs-1',
        bookingId: 'booking-1',
        serviceId: 'svc-1',
        service: { id: 'svc-1', requiredArtistCount: 2 },
        requestedArtistId: null,
        plannedStartAt: new Date('2026-09-15T10:00:00Z'),
        plannedEndAt: new Date('2026-09-15T10:45:00Z'),
        assignmentStrategy: 'AUTO_ASSIGN',
        assignments: [{ artistId: 'artist-1', role: 'SUPPORT', status: 'CONFIRMED' }],
      });
      mockPrisma.artistService.findFirst.mockResolvedValue({ id: 'as-1' });
      mockPrisma.bookingServiceAssignment.findMany.mockResolvedValue([{ role: 'SUPPORT' }]);

      const request: AssignArtistRequest = {
        bookingServiceId: 'bs-1',
        artistId: 'artist-2',
        role: 'SUPPORT', // Duplicate SUPPORT
        assignmentSource: 'FLOOR_MANAGER',
        assignedByStaffId: 'staff-1',
      };

      await expect(service.assignArtist(request, 'staff-1')).rejects.toThrow('DUPLICATE_ROLE');
    });
  });

  describe('Lead/Support rules with requested artist', () => {
    it('should preserve client-requested artist as Lead', async () => {
      const bookingService = {
        id: 'bs-1',
        bookingId: 'booking-1',
        serviceId: 'svc-1',
        service: { id: 'svc-1', requiredArtistCount: 2 },
        requestedArtistId: 'requested-artist-1', // Client requested this artist
        plannedStartAt: new Date('2026-09-15T10:00:00Z'),
        plannedEndAt: new Date('2026-09-15T10:45:00Z'),
        assignmentStrategy: 'SPECIFIC_ARTIST',
        assignments: [],
      };

      mockPrisma.bookingService.findUnique.mockResolvedValue({ ...bookingService, assignments: [] });
      mockPrisma.artistService.findFirst.mockResolvedValue({ id: 'as-1' });
      mockPrisma.bookingServiceAssignment.findFirst.mockResolvedValue(null);
      mockPrisma.bookingServiceAssignment.findMany.mockResolvedValue([]);
      mockPrisma.bookingServiceAssignment.create.mockResolvedValue({
        id: 'assign-1',
        bookingServiceId: 'bs-1',
        artistId: 'requested-artist-1',
        role: 'LEAD',
        assignmentSource: 'FLOOR_MANAGER',
        status: 'CONFIRMED',
      });

      const request: AssignArtistRequest = {
        bookingServiceId: 'bs-1',
        artistId: 'requested-artist-1',
        role: 'PRIMARY', // Will be converted to LEAD
        assignmentSource: 'FLOOR_MANAGER',
        assignedByStaffId: 'staff-1',
      };

      const result = await service.assignArtist(request, 'staff-1');
      expect(result.role).toBe('LEAD');
    });

    it('should assign support artist separately for requested lead', async () => {
      mockPrisma.bookingService.findUnique.mockResolvedValue({
        id: 'bs-1',
        bookingId: 'booking-1',
        serviceId: 'svc-1',
        service: { id: 'svc-1', requiredArtistCount: 2 },
        requestedArtistId: 'requested-artist-1',
        plannedStartAt: new Date('2026-09-15T10:00:00Z'),
        plannedEndAt: new Date('2026-09-15T10:45:00Z'),
        assignmentStrategy: 'SPECIFIC_ARTIST',
        assignments: [{ artistId: 'requested-artist-1', role: 'LEAD', status: 'CONFIRMED' }],
      });
      mockPrisma.artistService.findFirst.mockResolvedValue({ id: 'as-1' });
      mockPrisma.bookingServiceAssignment.findFirst.mockResolvedValue(null);
      mockPrisma.bookingServiceAssignment.findMany.mockResolvedValue([{ role: 'LEAD' }]);
      mockPrisma.bookingServiceAssignment.create.mockResolvedValue({
        id: 'assign-2',
        bookingServiceId: 'bs-1',
        artistId: 'support-artist-1',
        role: 'SUPPORT',
        assignmentSource: 'FLOOR_MANAGER',
        status: 'CONFIRMED',
      });

      const request: AssignArtistRequest = {
        bookingServiceId: 'bs-1',
        artistId: 'support-artist-1',
        role: 'SUPPORT',
        assignmentSource: 'FLOOR_MANAGER',
        assignedByStaffId: 'staff-1',
      };

      const result = await service.assignArtist(request, 'staff-1');
      expect(result.role).toBe('SUPPORT');
    });

    it('should never silently replace requested lead', async () => {
      mockPrisma.bookingService.findUnique.mockResolvedValue({
        id: 'bs-1',
        bookingId: 'booking-1',
        serviceId: 'svc-1',
        service: { id: 'svc-1', requiredArtistCount: 2 },
        requestedArtistId: 'requested-artist-1',
        plannedStartAt: new Date('2026-09-15T10:00:00Z'),
        plannedEndAt: new Date('2026-09-15T10:45:00Z'),
        assignmentStrategy: 'SPECIFIC_ARTIST',
        assignments: [{ artistId: 'requested-artist-1', role: 'LEAD', status: 'CONFIRMED' }],
      });
      mockPrisma.artistService.findFirst.mockResolvedValue({ id: 'as-1' });

      // Try to assign a different artist as LEAD when requested artist already exists
      const request: AssignArtistRequest = {
        bookingServiceId: 'bs-1',
        artistId: 'another-artist',
        role: 'LEAD', // Trying to add another LEAD
        assignmentSource: 'FLOOR_MANAGER',
        assignedByStaffId: 'staff-1',
      };

      await expect(service.assignArtist(request, 'staff-1')).rejects.toThrow('DUPLICATE_ROLE');
    });
  });

  describe('Dual capacity protection', () => {
    it('should check availability for both artists', async () => {
      const validateSpy = vi.mocked(availabilityService.validateSlotAvailability);
      validateSpy.mockResolvedValue(true);

      // First artist (LEAD)
      mockPrisma.bookingService.findUnique.mockResolvedValue({
        id: 'bs-1',
        bookingId: 'booking-1',
        serviceId: 'svc-1',
        service: { id: 'svc-1', requiredArtistCount: 2 },
        requestedArtistId: null,
        plannedStartAt: new Date('2026-09-15T10:00:00Z'),
        plannedEndAt: new Date('2026-09-15T10:45:00Z'),
        assignmentStrategy: 'AUTO_ASSIGN',
        assignments: [],
      });
      mockPrisma.artistService.findFirst.mockResolvedValue({ id: 'as-1' });
      mockPrisma.bookingServiceAssignment.findFirst.mockResolvedValue(null);
      mockPrisma.bookingServiceAssignment.findMany.mockResolvedValue([]);
      mockPrisma.bookingServiceAssignment.create.mockResolvedValue({
        id: 'assign-1',
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'LEAD',
        assignmentSource: 'FLOOR_MANAGER',
        status: 'CONFIRMED',
      });

      const request1: AssignArtistRequest = {
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'LEAD',
        assignmentSource: 'FLOOR_MANAGER',
        assignedByStaffId: 'staff-1',
      };

      await service.assignArtist(request1, 'staff-1');
      expect(validateSpy).toHaveBeenCalledWith('artist-1', expect.any(Date), expect.any(Date));

      // Second artist (SUPPORT) - validateSpy should be called again
      mockPrisma.bookingService.findUnique.mockResolvedValue({
        id: 'bs-1',
        bookingId: 'booking-1',
        serviceId: 'svc-1',
        service: { id: 'svc-1', requiredArtistCount: 2 },
        requestedArtistId: null,
        plannedStartAt: new Date('2026-09-15T10:00:00Z'),
        plannedEndAt: new Date('2026-09-15T10:45:00Z'),
        assignmentStrategy: 'AUTO_ASSIGN',
        assignments: [{ artistId: 'artist-1', role: 'LEAD', status: 'CONFIRMED' }],
      });
      mockPrisma.bookingServiceAssignment.findFirst.mockResolvedValue(null);
      mockPrisma.bookingServiceAssignment.findMany.mockResolvedValue([{ role: 'LEAD' }]);
      mockPrisma.bookingServiceAssignment.create.mockResolvedValue({
        id: 'assign-2',
        bookingServiceId: 'bs-1',
        artistId: 'artist-2',
        role: 'SUPPORT',
        assignmentSource: 'FLOOR_MANAGER',
        status: 'CONFIRMED',
      });

      const request2: AssignArtistRequest = {
        bookingServiceId: 'bs-1',
        artistId: 'artist-2',
        role: 'SUPPORT',
        assignmentSource: 'FLOOR_MANAGER',
        assignedByStaffId: 'staff-1',
      };

      await service.assignArtist(request2, 'staff-1');
      expect(validateSpy).toHaveBeenCalledTimes(2);
      expect(validateSpy).toHaveBeenCalledWith('artist-2', expect.any(Date), expect.any(Date));
    });

    it('should reject if Lead has conflict', async () => {
      vi.mocked(availabilityService.validateSlotAvailability).mockResolvedValue(false);

      mockPrisma.bookingService.findUnique.mockResolvedValue({
        id: 'bs-1',
        bookingId: 'booking-1',
        serviceId: 'svc-1',
        service: { id: 'svc-1', requiredArtistCount: 2 },
        requestedArtistId: null,
        plannedStartAt: new Date('2026-09-15T10:00:00Z'),
        plannedEndAt: new Date('2026-09-15T10:45:00Z'),
        assignmentStrategy: 'AUTO_ASSIGN',
        assignments: [],
      });
      mockPrisma.artistService.findFirst.mockResolvedValue({ id: 'as-1' });

      const request: AssignArtistRequest = {
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'LEAD',
        assignmentSource: 'FLOOR_MANAGER',
        assignedByStaffId: 'staff-1',
      };

      await expect(service.assignArtist(request, 'staff-1')).rejects.toThrow('ARTIST_UNAVAILABLE');
    });

    it('should reject if Support has conflict', async () => {
      // First assignment succeeds
      validateSpy = vi.mocked(availabilityService.validateSlotAvailability);
      validateSpy.mockResolvedValueOnce(true);

      mockPrisma.bookingService.findUnique.mockResolvedValue({
        id: 'bs-1',
        bookingId: 'booking-1',
        serviceId: 'svc-1',
        service: { id: 'svc-1', requiredArtistCount: 2 },
        requestedArtistId: null,
        plannedStartAt: new Date('2026-09-15T10:00:00Z'),
        plannedEndAt: new Date('2026-09-15T10:45:00Z'),
        assignmentStrategy: 'AUTO_ASSIGN',
        assignments: [],
      });
      mockPrisma.artistService.findFirst.mockResolvedValue({ id: 'as-1' });
      mockPrisma.bookingServiceAssignment.findFirst.mockResolvedValue(null);
      mockPrisma.bookingServiceAssignment.findMany.mockResolvedValue([]);
      mockPrisma.bookingServiceAssignment.create.mockResolvedValue({
        id: 'assign-1',
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'LEAD',
        assignmentSource: 'FLOOR_MANAGER',
        status: 'CONFIRMED',
      });

      const request1: AssignArtistRequest = {
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'LEAD',
        assignmentSource: 'FLOOR_MANAGER',
        assignedByStaffId: 'staff-1',
      };

      await service.assignArtist(request1, 'staff-1');

      // Second assignment - Support has conflict
      validateSpy.mockResolvedValueOnce(false);

      mockPrisma.bookingService.findUnique.mockResolvedValue({
        id: 'bs-1',
        bookingId: 'booking-1',
        serviceId: 'svc-1',
        service: { id: 'svc-1', requiredArtistCount: 2 },
        requestedArtistId: null,
        plannedStartAt: new Date('2026-09-15T10:00:00Z'),
        plannedEndAt: new Date('2026-09-15T10:45:00Z'),
        assignmentStrategy: 'AUTO_ASSIGN',
        assignments: [{ artistId: 'artist-1', role: 'LEAD', status: 'CONFIRMED' }],
      });
      mockPrisma.artistService.findFirst.mockResolvedValue({ id: 'as-1' });
      mockPrisma.bookingServiceAssignment.findFirst.mockResolvedValue(null);
      mockPrisma.bookingServiceAssignment.findMany.mockResolvedValue([{ role: 'LEAD' }]);

      const request2: AssignArtistRequest = {
        bookingServiceId: 'bs-1',
        artistId: 'artist-2',
        role: 'SUPPORT',
        assignmentSource: 'FLOOR_MANAGER',
        assignedByStaffId: 'staff-1',
      };

      await expect(service.assignArtist(request2, 'staff-1')).rejects.toThrow('ARTIST_UNAVAILABLE');
    });

    it('should reject if one artist is free and other is busy (both must be free)', async () => {
      // First succeeds
      validateSpy = vi.mocked(availabilityService.validateSlotAvailability);
      validateSpy.mockResolvedValueOnce(true);

      mockPrisma.bookingService.findUnique.mockResolvedValue({
        id: 'bs-1',
        bookingId: 'booking-1',
        serviceId: 'svc-1',
        service: { id: 'svc-1', requiredArtistCount: 2 },
        requestedArtistId: null,
        plannedStartAt: new Date('2026-09-15T10:00:00Z'),
        plannedEndAt: new Date('2026-09-15T10:45:00Z'),
        assignmentStrategy: 'AUTO_ASSIGN',
        assignments: [],
      });
      mockPrisma.artistService.findFirst.mockResolvedValue({ id: 'as-1' });
      mockPrisma.bookingServiceAssignment.findFirst.mockResolvedValue(null);
      mockPrisma.bookingServiceAssignment.findMany.mockResolvedValue([]);
      mockPrisma.bookingServiceAssignment.create.mockResolvedValue({
        id: 'assign-1',
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'LEAD',
        assignmentSource: 'FLOOR_MANAGER',
        status: 'CONFIRMED',
      });

      const request1: AssignArtistRequest = {
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'LEAD',
        assignmentSource: 'FLOOR_MANAGER',
        assignedByStaffId: 'staff-1',
      };

      await service.assignArtist(request1, 'staff-1');

      // Second - busy
      validateSpy.mockResolvedValueOnce(false);

      mockPrisma.bookingService.findUnique.mockResolvedValue({
        id: 'bs-1',
        bookingId: 'booking-1',
        serviceId: 'svc-1',
        service: { id: 'svc-1', requiredArtistCount: 2 },
        requestedArtistId: null,
        plannedStartAt: new Date('2026-09-15T10:00:00Z'),
        plannedEndAt: new Date('2026-09-15T10:45:00Z'),
        assignmentStrategy: 'AUTO_ASSIGN',
        assignments: [{ artistId: 'artist-1', role: 'LEAD', status: 'CONFIRMED' }],
      });
      mockPrisma.artistService.findFirst.mockResolvedValue({ id: 'as-1' });
      mockPrisma.bookingServiceAssignment.findFirst.mockResolvedValue(null);
      mockPrisma.bookingServiceAssignment.findMany.mockResolvedValue([{ role: 'LEAD' }]);

      const request2: AssignArtistRequest = {
        bookingServiceId: 'bs-1',
        artistId: 'artist-2',
        role: 'SUPPORT',
        assignmentSource: 'FLOOR_MANAGER',
        assignedByStaffId: 'staff-1',
      };

      await expect(service.assignArtist(request2, 'staff-1')).rejects.toThrow('ARTIST_UNAVAILABLE');
    });
  });

  describe('One-artist regression', () => {
    it('should keep 1-artist behavior unchanged', async () => {
      mockPrisma.bookingService.findUnique.mockResolvedValue({
        id: 'bs-1',
        bookingId: 'booking-1',
        serviceId: 'svc-1',
        service: { id: 'svc-1', requiredArtistCount: 1 },
        requestedArtistId: null,
        plannedStartAt: new Date('2026-09-15T10:00:00Z'),
        plannedEndAt: new Date('2026-09-15T10:45:00Z'),
        assignmentStrategy: 'AUTO_ASSIGN',
        assignments: [],
      });
      mockPrisma.artistService.findFirst.mockResolvedValue({ id: 'as-1' });
      mockPrisma.bookingServiceAssignment.findFirst.mockResolvedValue(null);
      mockPrisma.bookingServiceAssignment.create.mockResolvedValue({
        id: 'assign-1',
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'PRIMARY',
        assignmentSource: 'FLOOR_MANAGER',
        status: 'CONFIRMED',
      });

      const request: AssignArtistRequest = {
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'PRIMARY',
        assignmentSource: 'FLOOR_MANAGER',
        assignedByStaffId: 'staff-1',
      };

      const result = await service.assignArtist(request, 'staff-1');
      expect(result.role).toBe('PRIMARY');

      // Should go directly to FULLY_ASSIGNED
      expect(mockPrisma.bookingService.update).toHaveBeenCalledWith({
        where: { id: 'bs-1' },
        data: { assignmentStatus: 'FULLY_ASSIGNED' },
      });
    });

    it('should reject non-PRIMARY role for 1-artist service', async () => {
      mockPrisma.bookingService.findUnique.mockResolvedValue({
        id: 'bs-1',
        bookingId: 'booking-1',
        serviceId: 'svc-1',
        service: { id: 'svc-1', requiredArtistCount: 1 },
        requestedArtistId: null,
        plannedStartAt: new Date('2026-09-15T10:00:00Z'),
        plannedEndAt: new Date('2026-09-15T10:45:00Z'),
        assignmentStrategy: 'AUTO_ASSIGN',
        assignments: [],
      });
      mockPrisma.artistService.findFirst.mockResolvedValue({ id: 'as-1' });

      const request: AssignArtistRequest = {
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'LEAD', // Invalid for 1-artist
        assignmentSource: 'FLOOR_MANAGER',
        assignedByStaffId: 'staff-1',
      };

      await expect(service.assignArtist(request, 'staff-1')).rejects.toThrow('INVALID_ROLE');
    });
  });
});

// Reference to validateSpy for tests
const validateSpy = vi.mocked(availabilityService.validateSlotAvailability);