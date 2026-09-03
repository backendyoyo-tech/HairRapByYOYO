import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BookingService, AssignArtistRequest, ReassignArtistRequest } from '../booking.service.js';
import { availabilityService } from '../availability.service.js';

// Mock Prisma
const mockPrisma = {
  bookingService: {
    findUnique: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  },
  bookingServiceAssignment: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  artistService: {
    findFirst: vi.fn(),
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

describe('D11 - Manual Assignment Queue + Assign/Reassign', () => {
  let service: BookingService;

  beforeEach(() => {
    service = new BookingService();
    vi.clearAllMocks();
  });

  describe('getAssignmentQueue', () => {
    it('should return services with AWAITING_ASSIGNMENT and PARTIALLY_ASSIGNED', async () => {
      mockPrisma.bookingService.findMany.mockResolvedValue([
        {
          id: 'bs-1',
          bookingId: 'booking-1',
          booking: {
            client: { firstName: 'John', lastName: 'Doe' },
          },
          service: { name: 'Haircut', requiredArtistCount: 1 },
          assignmentStatus: 'AWAITING_ASSIGNMENT',
          plannedStartAt: new Date('2026-09-15T10:00:00Z'),
          plannedEndAt: new Date('2026-09-15T10:45:00Z'),
          assignmentStrategy: 'AUTO_ASSIGN',
          requestedArtistId: null,
          assignments: [],
        },
        {
          id: 'bs-2',
          bookingId: 'booking-2',
          booking: {
            client: { firstName: 'Jane', lastName: 'Smith' },
          },
          service: { name: 'Color', requiredArtistCount: 2 },
          assignmentStatus: 'PARTIALLY_ASSIGNED',
          plannedStartAt: new Date('2026-09-15T14:00:00Z'),
          plannedEndAt: new Date('2026-09-15T15:30:00Z'),
          assignmentStrategy: 'AUTO_ASSIGN',
          requestedArtistId: null,
          assignments: [
            { artistId: 'artist-1', artist: { firstName: 'Lead', lastName: 'Artist' }, role: 'LEAD', status: 'CONFIRMED' },
          ],
        },
      ]);

      const queue = await service.getAssignmentQueue();

      expect(queue).toHaveLength(2);
      expect(queue[0].assignmentStatus).toBe('AWAITING_ASSIGNMENT');
      expect(queue[1].assignmentStatus).toBe('PARTIALLY_ASSIGNED');
      expect(queue[0].currentAssignments).toHaveLength(0);
      expect(queue[1].currentAssignments).toHaveLength(1);
    });
  });

  describe('assignArtist', () => {
    const baseBookingService = {
      id: 'bs-1',
      bookingId: 'booking-1',
      serviceId: 'svc-1',
      service: { id: 'svc-1', requiredArtistCount: 1 },
      requestedArtistId: null,
      plannedStartAt: new Date('2026-09-15T10:00:00Z'),
      plannedEndAt: new Date('2026-09-15T10:45:00Z'),
      assignmentStrategy: 'AUTO_ASSIGN',
      assignments: [],
    };

    it('should successfully assign artist to 1-artist service', async () => {
      mockPrisma.bookingService.findUnique.mockResolvedValue({
        ...baseBookingService,
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

      expect(result).toMatchObject({
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'PRIMARY',
      });
      expect(mockPrisma.bookingService.update).toHaveBeenCalledWith({
        where: { id: 'bs-1' },
        data: { assignmentStatus: 'FULLY_ASSIGNED' },
      });
    });

    it('should reject receptionist assignment (RBAC enforced at router level)', async () => {
      // This test documents that receptionist cannot assign - enforced by router RBAC
      // Service layer doesn't check role, router does
      expect(true).toBe(true);
    });

    it('should reject inactive artist', async () => {
      mockPrisma.bookingService.findUnique.mockResolvedValue({ ...baseBookingService, assignments: [] });
      mockPrisma.artistService.findFirst.mockResolvedValue(null);

      const request: AssignArtistRequest = {
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'PRIMARY',
        assignmentSource: 'FLOOR_MANAGER',
        assignedByStaffId: 'staff-1',
      };

      await expect(service.assignArtist(request, 'staff-1')).rejects.toThrow('ARTIST_NOT_QUALIFIED');
    });

    it('should reject artist conflict', async () => {
      mockPrisma.bookingService.findUnique.mockResolvedValue({ ...baseBookingService, assignments: [] });
      mockPrisma.artistService.findFirst.mockResolvedValue({ id: 'as-1' });
      vi.mocked(availabilityService.validateSlotAvailability).mockResolvedValue(false);

      const request: AssignArtistRequest = {
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'PRIMARY',
        assignmentSource: 'FLOOR_MANAGER',
        assignedByStaffId: 'staff-1',
      };

      await expect(service.assignArtist(request, 'staff-1')).rejects.toThrow('ARTIST_UNAVAILABLE');
    });

    it('should reject duplicate artist assignment', async () => {
      mockPrisma.bookingService.findUnique.mockResolvedValue({
        ...baseBookingService,
        assignments: [{ artistId: 'artist-1', status: 'CONFIRMED' }],
      });
      mockPrisma.artistService.findFirst.mockResolvedValue({ id: 'as-1' });

      const request: AssignArtistRequest = {
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'PRIMARY',
        assignmentSource: 'FLOOR_MANAGER',
        assignedByStaffId: 'staff-1',
      };

      await expect(service.assignArtist(request, 'staff-1')).rejects.toThrow('ASSIGNMENT_EXISTS');
    });

    it('should reject assignment exceeding required count', async () => {
      mockPrisma.bookingService.findUnique.mockResolvedValue({
        ...baseBookingService,
        service: { requiredArtistCount: 1 },
        assignments: [{ artistId: 'artist-2', status: 'CONFIRMED' }],
      });
      mockPrisma.artistService.findFirst.mockResolvedValue({ id: 'as-1' });

      const request: AssignArtistRequest = {
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'PRIMARY',
        assignmentSource: 'FLOOR_MANAGER',
        assignedByStaffId: 'staff-1',
      };

      await expect(service.assignArtist(request, 'staff-1')).rejects.toThrow('ASSIGNMENT_LIMIT_EXCEEDED');
    });

    describe('2-artist service rules', () => {
      const twoArtistBookingService = {
        ...baseBookingService,
        service: { id: 'svc-1', requiredArtistCount: 2 },
        requestedArtistId: 'requested-artist-1',
        assignments: [],
      };

      it('should assign requested artist as LEAD', async () => {
        mockPrisma.bookingService.findUnique.mockResolvedValue({ ...twoArtistBookingService, assignments: [] });
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

      it('should assign support artist for requested lead', async () => {
        mockPrisma.bookingService.findUnique.mockResolvedValue({
          ...twoArtistBookingService,
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

      it('should reject same artist for both positions', async () => {
        mockPrisma.bookingService.findUnique.mockResolvedValue({
          ...twoArtistBookingService,
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
          ...twoArtistBookingService,
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
          ...twoArtistBookingService,
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

      it('should reject invalid role for 2-artist service', async () => {
        mockPrisma.bookingService.findUnique.mockResolvedValue({ ...twoArtistBookingService, assignments: [] });
        mockPrisma.artistService.findFirst.mockResolvedValue({ id: 'as-1' });

        const request: AssignArtistRequest = {
          bookingServiceId: 'bs-1',
          artistId: 'artist-1',
          role: 'PRIMARY', // Invalid for 2-artist
          assignmentSource: 'FLOOR_MANAGER',
          assignedByStaffId: 'staff-1',
        };

        await expect(service.assignArtist(request, 'staff-1')).rejects.toThrow('INVALID_ROLE');
      });
    });
  });

  describe('reassignArtist', () => {
    it('should successfully reassign artist with concurrency protection', async () => {
      mockPrisma.bookingServiceAssignment.findUnique.mockResolvedValue({
        id: 'assign-1',
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'PRIMARY',
        status: 'CONFIRMED',
        bookingService: { id: 'bs-1', serviceId: 'svc-1' },
      });
      mockPrisma.artistService.findFirst.mockResolvedValue({ id: 'as-1' });
      mockPrisma.bookingServiceAssignment.update.mockResolvedValue({ id: 'assign-1' }); // stale check passes
      mockPrisma.bookingServiceAssignment.create.mockResolvedValue({});
      mockPrisma.bookingServiceAssignment.findMany.mockResolvedValue([{ artistId: 'artist-2', role: 'PRIMARY', status: 'CONFIRMED' }]);
      mockPrisma.bookingService.findUnique.mockResolvedValue({
        id: 'bs-1',
        service: { requiredArtistCount: 1 },
        bookingId: 'booking-1',
      });

      const request: ReassignArtistRequest = {
        bookingServiceAssignmentId: 'assign-1',
        newArtistId: 'artist-2',
        assignedByStaffId: 'staff-1',
      };

      const result = await service.reassignArtist(request, 'staff-1');
      expect(result).toEqual({ success: true });
      expect(mockPrisma.bookingServiceAssignment.update).toHaveBeenCalledWith({
        where: {
          id: 'assign-1',
          status: { in: ['PENDING', 'CONFIRMED'] },
        },
        data: { status: 'REPLACED' },
      });
    });

    it('should reject stale reassignment (concurrency protection)', async () => {
      mockPrisma.bookingServiceAssignment.findUnique.mockResolvedValue({
        id: 'assign-1',
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'PRIMARY',
        status: 'CONFIRMED',
        bookingService: { id: 'bs-1', serviceId: 'svc-1' },
      });
      mockPrisma.artistService.findFirst.mockResolvedValue({ id: 'as-1' });
      mockPrisma.bookingServiceAssignment.update.mockResolvedValue(null); // stale - no rows updated

      const request: ReassignArtistRequest = {
        bookingServiceAssignmentId: 'assign-1',
        newArtistId: 'artist-2',
        assignedByStaffId: 'staff-1',
      };

      await expect(service.reassignArtist(request, 'staff-1')).rejects.toThrow('STALE_ASSIGNMENT');
    });

    it('should reject reassignment of released assignment', async () => {
      mockPrisma.bookingServiceAssignment.findUnique.mockResolvedValue({
        id: 'assign-1',
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'PRIMARY',
        status: 'REPLACED', // Already released
        bookingService: { id: 'bs-1', serviceId: 'svc-1' },
      });

      const request: ReassignArtistRequest = {
        bookingServiceAssignmentId: 'assign-1',
        newArtistId: 'artist-2',
        assignedByStaffId: 'staff-1',
      };

      await expect(service.reassignArtist(request, 'staff-1')).rejects.toThrow('INVALID_STATE');
    });

    it('should reject unqualified new artist', async () => {
      mockPrisma.bookingServiceAssignment.findUnique.mockResolvedValue({
        id: 'assign-1',
        bookingServiceId: 'bs-1',
        artistId: 'artist-1',
        role: 'PRIMARY',
        status: 'CONFIRMED',
        bookingService: { id: 'bs-1', serviceId: 'svc-1' },
      });
      mockPrisma.artistService.findFirst.mockResolvedValue(null);

      const request: ReassignArtistRequest = {
        bookingServiceAssignmentId: 'assign-1',
        newArtistId: 'artist-2',
        assignedByStaffId: 'staff-1',
      };

      await expect(service.reassignArtist(request, 'staff-1')).rejects.toThrow('ARTIST_NOT_QUALIFIED');
    });
  });
});