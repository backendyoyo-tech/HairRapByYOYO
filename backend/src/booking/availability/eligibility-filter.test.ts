/**
 * Unit tests for Artist/Service Eligibility Filter - D7.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma client factory
const createMockPrisma = () => ({
  artistProfile: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  artistService: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
});

describe('D7.4 - Artist/Service Eligibility Filter', () => {
  
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let eligibilityFilter: ReturnType<typeof import('./eligibility-filter.js').createEligibilityFilter>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
    const { createEligibilityFilter } = await import('./eligibility-filter.js');
    eligibilityFilter = createEligibilityFilter(mockPrisma as any);
  });

  describe('getEligibleArtists', () => {
    it('should return artists eligible for requested services', async () => {
      const mockArtists = [
        {
          id: 'artist-1',
          firstName: 'John',
          lastName: 'Doe',
          displayName: 'John D.',
          isAvailable: true,
          artistServices: [
            { serviceId: 'service-1', isActive: true },
            { serviceId: 'service-2', isActive: true },
          ],
        },
        {
          id: 'artist-2',
          firstName: 'Jane',
          lastName: 'Smith',
          displayName: 'Jane S.',
          isAvailable: true,
          artistServices: [
            { serviceId: 'service-1', isActive: true },
          ],
        },
      ];

      mockPrisma.artistProfile.findMany.mockResolvedValue(mockArtists);

      const result = await eligibilityFilter.getEligibleArtists({
        serviceIds: ['service-1', 'service-2'],
      });

      expect(result).toHaveLength(2);
      expect(mockPrisma.artistProfile.findMany).toHaveBeenCalledWith({
        where: {
          isAvailable: true,
          artistServices: {
            some: {
              serviceId: { in: ['service-1', 'service-2'] },
              isActive: true,
            },
          },
        },
        include: {
          artistServices: {
            where: {
              serviceId: { in: ['service-1', 'service-2'] },
              isActive: true,
            },
            select: {
              serviceId: true,
              isActive: true,
            },
          },
        },
      });
    });

    it('should filter by requested artist ID', async () => {
      const mockArtists = [
        {
          id: 'artist-1',
          firstName: 'John',
          lastName: 'Doe',
          displayName: 'John D.',
          isAvailable: true,
          artistServices: [{ serviceId: 'service-1', isActive: true }],
        },
      ];

      mockPrisma.artistProfile.findMany.mockResolvedValue(mockArtists);

      const result = await eligibilityFilter.getEligibleArtists({
        serviceIds: ['service-1'],
        requestedArtistId: 'artist-1',
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('artist-1');
      expect(mockPrisma.artistProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'artist-1',
          }),
        })
      );
    });
  });

  describe('isArtistEligibleForService', () => {
    it('should return true for eligible artist', async () => {
      mockPrisma.artistService.findFirst.mockResolvedValue({
        artistId: 'artist-1',
        serviceId: 'service-1',
        isActive: true,
      });
      mockPrisma.artistProfile.findUnique.mockResolvedValue({
        id: 'artist-1',
        isAvailable: true,
      });

      const result = await eligibilityFilter.isArtistEligibleForService('artist-1', 'service-1');
      expect(result).toBe(true);
    });

    it('should return false if artist-service mapping is inactive', async () => {
      mockPrisma.artistService.findFirst.mockResolvedValue(null);

      const result = await eligibilityFilter.isArtistEligibleForService('artist-1', 'service-1');
      expect(result).toBe(false);
    });

    it('should return false if artist profile is inactive', async () => {
      mockPrisma.artistService.findFirst.mockResolvedValue({
        artistId: 'artist-1',
        serviceId: 'service-1',
        isActive: true,
      });
      mockPrisma.artistProfile.findUnique.mockResolvedValue({
        id: 'artist-1',
        isAvailable: false,
      });

      const result = await eligibilityFilter.isArtistEligibleForService('artist-1', 'service-1');
      expect(result).toBe(false);
    });

    it('should return false if artist not found', async () => {
      mockPrisma.artistService.findFirst.mockResolvedValue({
        artistId: 'artist-1',
        serviceId: 'service-1',
        isActive: true,
      });
      mockPrisma.artistProfile.findUnique.mockResolvedValue(null);

      const result = await eligibilityFilter.isArtistEligibleForService('artist-1', 'service-1');
      expect(result).toBe(false);
    });
  });

  describe('getEligibilityMap', () => {
    it('should return map of artist eligibility for a service', async () => {
      mockPrisma.artistService.findMany.mockResolvedValue([
        { artistId: 'artist-1' },
        { artistId: 'artist-2' },
      ]);
      mockPrisma.artistProfile.findMany.mockResolvedValue([
        { id: 'artist-1', isAvailable: true },
        { id: 'artist-2', isAvailable: true },
        { id: 'artist-3', isAvailable: true }, // Not in mappings
      ]);

      const result = await eligibilityFilter.getEligibilityMap(
        ['artist-1', 'artist-2', 'artist-3'],
        'service-1'
      );

      expect(result.get('artist-1')).toBe(true);
      expect(result.get('artist-2')).toBe(true);
      expect(result.get('artist-3')).toBe(false); // Not mapped
    });

    it('should return false for inactive artists', async () => {
      mockPrisma.artistService.findMany.mockResolvedValue([
        { artistId: 'artist-1' },
      ]);
      mockPrisma.artistProfile.findMany.mockResolvedValue([
        { id: 'artist-1', isAvailable: false }, // Inactive
      ]);

      const result = await eligibilityFilter.getEligibilityMap(['artist-1'], 'service-1');
      expect(result.get('artist-1')).toBe(false);
    });
  });

  describe('filterSlotsByEligibility', () => {
    it('should filter slots by eligibility map', () => {
      const slots = [
        { artistId: 'artist-1', startAt: new Date(), endAt: new Date() },
        { artistId: 'artist-2', startAt: new Date(), endAt: new Date() },
        { artistId: 'artist-3', startAt: new Date(), endAt: new Date() },
      ];

      const eligibilityMap = new Map([
        ['artist-1', true],
        ['artist-2', false],
        ['artist-3', true],
      ]);

      const result = eligibilityFilter.filterSlotsByEligibility(slots, eligibilityMap);

      expect(result).toHaveLength(2);
      expect(result.map(s => s.artistId)).toEqual(['artist-1', 'artist-3']);
    });

    it('should return empty array if no artists eligible', () => {
      const slots = [
        { artistId: 'artist-1', startAt: new Date(), endAt: new Date() },
      ];

      const eligibilityMap = new Map([
        ['artist-1', false],
      ]);

      const result = eligibilityFilter.filterSlotsByEligibility(slots, eligibilityMap);
      expect(result).toHaveLength(0);
    });
  });

  describe('computeMultiServiceEligibility', () => {
    it('should check specific artist eligibility for ALL services', async () => {
      mockPrisma.artistService.findFirst
        .mockResolvedValueOnce({ artistId: 'artist-1', serviceId: 'service-1', isActive: true })
        .mockResolvedValueOnce({ artistId: 'artist-1', serviceId: 'service-2', isActive: true });
      mockPrisma.artistProfile.findUnique.mockResolvedValue({ id: 'artist-1', isAvailable: true });

      const result = await eligibilityFilter.computeMultiServiceEligibility(
        ['service-1', 'service-2'],
        'artist-1'
      );

      expect(result.fullyEligibleArtists).toEqual(['artist-1']);
      expect(result.perServiceEligible.size).toBe(0);
    });

    it('should return empty fullyEligibleArtists if artist not eligible for all', async () => {
      mockPrisma.artistService.findFirst
        .mockResolvedValueOnce({ artistId: 'artist-1', serviceId: 'service-1', isActive: true })
        .mockResolvedValueOnce(null); // Not eligible for service-2
      mockPrisma.artistProfile.findUnique.mockResolvedValue({ id: 'artist-1', isAvailable: true });

      const result = await eligibilityFilter.computeMultiServiceEligibility(
        ['service-1', 'service-2'],
        'artist-1'
      );

      expect(result.fullyEligibleArtists).toEqual([]);
    });

    it('should return per-service eligible artists for auto-assign', async () => {
      mockPrisma.artistProfile.findMany
        .mockResolvedValueOnce([{ id: 'artist-1' }, { id: 'artist-2' }]) // for service-1
        .mockResolvedValueOnce([{ id: 'artist-2' }, { id: 'artist-3' }]); // for service-2

      const result = await eligibilityFilter.computeMultiServiceEligibility(
        ['service-1', 'service-2']
      );

      expect(result.fullyEligibleArtists).toEqual([]);
      expect(result.perServiceEligible.get('service-1')).toEqual(['artist-1', 'artist-2']);
      expect(result.perServiceEligible.get('service-2')).toEqual(['artist-2', 'artist-3']);
    });

    it('should return empty fullyEligibleArtists for auto-assign (no specific artist)', async () => {
      mockPrisma.artistProfile.findMany
        .mockResolvedValueOnce([{ id: 'artist-1' }])
        .mockResolvedValueOnce([{ id: 'artist-2' }]);

      const result = await eligibilityFilter.computeMultiServiceEligibility(['service-1', 'service-2']);

      expect(result.fullyEligibleArtists).toEqual([]);
    });
  });
});