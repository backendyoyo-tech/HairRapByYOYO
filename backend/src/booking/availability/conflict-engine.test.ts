/**
 * Unit tests for Existing Commitment Conflict Engine - D7.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma client factory
const createMockPrisma = () => ({
  bookingService: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  bookingServiceAssignment: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  bookingHoldResource: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
});

describe('D7.6 - Existing Commitment Conflict Engine', () => {
  
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let conflictEngine: ReturnType<typeof import('./conflict-engine.js').createConflictEngine>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma = {
      bookingService: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      bookingServiceAssignment: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      bookingHoldResource: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    };
    const { createConflictEngine } = await import('./conflict-engine.js');
    conflictEngine = createConflictEngine(mockPrisma as any);
  });

  describe('hasOverlap', () => {
    it('should return true for exact overlap', () => {
      const start1 = new Date('2026-01-15T10:00:00');
      const end1 = new Date('2026-01-15T11:00:00');
      const start2 = new Date('2026-01-15T10:00:00');
      const end2 = new Date('2026-01-15T11:00:00');
      
      expect(conflictEngine.hasOverlap(start1, end1, start2, end2)).toBe(true);
    });

    it('should return true for partial overlap (start inside)', () => {
      const start1 = new Date('2026-01-15T10:00:00');
      const end1 = new Date('2026-01-15T11:00:00');
      const start2 = new Date('2026-01-15T10:30:00');
      const end2 = new Date('2026-01-15T11:30:00');
      
      expect(conflictEngine.hasOverlap(start1, end1, start2, end2)).toBe(true);
    });

    it('should return true for partial overlap (end inside)', () => {
      const start1 = new Date('2026-01-15T10:00:00');
      const end1 = new Date('2026-01-15T11:00:00');
      const start2 = new Date('2026-01-15T09:30:00');
      const end2 = new Date('2026-01-15T10:30:00');
      
      expect(conflictEngine.hasOverlap(start1, end1, start2, end2)).toBe(true);
    });

    it('should return true for one interval containing the other', () => {
      const start1 = new Date('2026-01-15T10:00:00');
      const end1 = new Date('2026-01-15T11:00:00');
      const start2 = new Date('2026-01-15T10:15:00');
      const end2 = new Date('2026-01-15T10:45:00');
      
      expect(conflictEngine.hasOverlap(start1, end1, start2, end2)).toBe(true);
    });

    it('should return false for non-overlapping intervals (before)', () => {
      const start1 = new Date('2026-01-15T10:00:00');
      const end1 = new Date('2026-01-15T11:00:00');
      const start2 = new Date('2026-01-15T11:00:00');
      const end2 = new Date('2026-01-15T12:00:00');
      
      expect(conflictEngine.hasOverlap(start1, end1, start2, end2)).toBe(false);
    });

    it('should return false for non-overlapping intervals (after)', () => {
      const start1 = new Date('2026-01-15T10:00:00');
      const end1 = new Date('2026-01-15T11:00:00');
      const start2 = new Date('2026-01-15T09:00:00');
      const end2 = new Date('2026-01-15T10:00:00');
      
      expect(conflictEngine.hasOverlap(start1, end1, start2, end2)).toBe(false);
    });

    it('should handle edge case where intervals touch at boundary', () => {
      const start1 = new Date('2026-01-15T10:00:00');
      const end1 = new Date('2026-01-15T11:00:00');
      const start2 = new Date('2026-01-15T11:00:00');
      const end2 = new Date('2026-01-15T12:00:00');
      
      // Half-open intervals: [start, end) - touching at boundary is NOT overlap
      expect(conflictEngine.hasOverlap(start1, end1, start2, end2)).toBe(false);
    });
  });

  describe('Blocking Status Constants', () => {
    it('should have correct booking statuses that block', () => {
      expect(conflictEngine.getBlockingStatuses().bookingStatuses).toContain('CONFIRMED');
      expect(conflictEngine.getBlockingStatuses().bookingStatuses).toContain('CHECKED_IN');
      expect(conflictEngine.getBlockingStatuses().bookingStatuses).toContain('IN_SERVICE');
      expect(conflictEngine.getBlockingStatuses().bookingStatuses).not.toContain('CANCELLED');
      expect(conflictEngine.getBlockingStatuses().bookingStatuses).not.toContain('NO_SHOW');
    });

    it('should have correct assignment statuses that block', () => {
      expect(conflictEngine.getBlockingStatuses().assignmentStatuses).toContain('PENDING');
      expect(conflictEngine.getBlockingStatuses().assignmentStatuses).toContain('CONFIRMED');
      expect(conflictEngine.getBlockingStatuses().assignmentStatuses).not.toContain('RELEASED');
      expect(conflictEngine.getBlockingStatuses().assignmentStatuses).not.toContain('REPLACED');
    });

    it('should have correct hold statuses that block', () => {
      expect(conflictEngine.getBlockingStatuses().holdStatuses).toContain('HOLD_ACTIVE');
      expect(conflictEngine.getBlockingStatuses().holdStatuses).not.toContain('HOLD_CONSUMED');
      expect(conflictEngine.getBlockingStatuses().holdStatuses).not.toContain('HOLD_EXPIRED');
      expect(conflictEngine.getBlockingStatuses().holdStatuses).not.toContain('HOLD_RELEASED');
    });
  });

  describe('getBlockingStatuses', () => {
    it('should return all blocking statuses', () => {
      const statuses = conflictEngine.getBlockingStatuses();
      
      expect(statuses.bookingStatuses).toEqual(['CONFIRMED', 'CHECKED_IN', 'IN_SERVICE']);
      expect(statuses.assignmentStatuses).toEqual(['PENDING', 'CONFIRMED']);
      expect(statuses.holdStatuses).toEqual(['HOLD_ACTIVE']);
    });
  });

  describe('filterSlotsByConflicts', () => {
    const createSlot = (artistId: string, hours: number, minutes: number, durationMinutes = 60) => ({
      artistId,
      startAt: new Date(`2026-01-15T${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`),
      endAt: new Date(new Date(`2026-01-15T${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`).getTime() + durationMinutes * 60000),
    });

    it('should filter out slots with artist-specific conflicts', () => {
      const slots = [
        { artistId: 'artist-1', startAt: new Date('2026-01-15T10:00:00'), endAt: new Date('2026-01-15T11:00:00') },
        { artistId: 'artist-1', startAt: new Date('2026-01-15T11:30:00'), endAt: new Date('2026-01-15T12:30:00') }, // Starts at 11:30, no overlap with 10:30-11:30
        { artistId: 'artist-2', startAt: new Date('2026-01-15T10:00:00'), endAt: new Date('2026-01-15T11:00:00') },
      ];

      const conflictMap = new Map([
        ['artist-1', [{ start: new Date('2026-01-15T10:30:00'), end: new Date('2026-01-15T11:30:00') }]],
      ]);

      const filtered = conflictEngine.filterSlotsByConflicts(slots, conflictMap, false);

      // artist-1 first slot (10:00-11:00) conflicts with 10:30-11:30
      // artist-1 second slot (11:30-12:30) does NOT conflict (starts at 11:30, conflict ends at 11:30)
      // artist-2 has no conflicts
      expect(filtered.length).toBe(2);
      expect(filtered.map(s => s.artistId)).toEqual(['artist-1', 'artist-2']);
      expect(filtered.find(s => s.artistId === 'artist-1')?.startAt.getHours()).toBe(11);
    });

    it('should filter out slots with anonymous capacity conflicts when enabled', () => {
      const slots = [
        { artistId: 'artist-1', startAt: new Date('2026-01-15T10:00:00'), endAt: new Date('2026-01-15T11:00:00') },
        { artistId: 'artist-2', startAt: new Date('2026-01-15T11:00:00'), endAt: new Date('2026-01-15T12:00:00') },
      ];

      const conflictMap = new Map([
        ['ANONYMOUS_CAPACITY', [{ start: new Date('2026-01-15T10:30:00'), end: new Date('2026-01-15T11:30:00') }]],
      ]);

      const filtered = conflictEngine.filterSlotsByConflicts(slots, conflictMap, true);

      // Both slots conflict with anonymous capacity
      expect(filtered.length).toBe(0);
    });

    it('should ignore anonymous capacity conflicts when disabled', () => {
      const slots = [
        { artistId: 'artist-1', startAt: new Date('2026-01-15T10:00:00'), endAt: new Date('2026-01-15T11:00:00') },
      ];

      const conflictMap = new Map([
        ['ANONYMOUS_CAPACITY', [{ start: new Date('2026-01-15T10:30:00'), end: new Date('2026-01-15T11:30:00') }]],
      ]);

      const filtered = conflictEngine.filterSlotsByConflicts(slots, conflictMap, false);

      // Anonymous capacity ignored
      expect(filtered.length).toBe(1);
    });

    it('should keep slots with no conflicts', () => {
      const slots = [
        { artistId: 'artist-1', startAt: new Date('2026-01-15T10:00:00'), endAt: new Date('2026-01-15T11:00:00') },
        { artistId: 'artist-2', startAt: new Date('2026-01-15T11:00:00'), endAt: new Date('2026-01-15T12:00:00') },
      ];

      const conflictMap = new Map([
        ['artist-3', [{ start: new Date('2026-01-15T10:30:00'), end: new Date('2026-01-15T11:30:00') }]],
      ]);

      const filtered = conflictEngine.filterSlotsByConflicts(slots, conflictMap, true);

      expect(filtered.length).toBe(2);
    });

    it('should handle boundary touching (not overlapping)', () => {
      const slots = [
        { artistId: 'artist-1', startAt: new Date('2026-01-15T11:00:00'), endAt: new Date('2026-01-15T12:00:00') },
      ];

      const conflictMap = new Map([
        ['artist-1', [{ start: new Date('2026-01-15T10:00:00'), end: new Date('2026-01-15T11:00:00') }]], // Ends exactly when slot starts
      ]);

      const filtered = conflictEngine.filterSlotsByConflicts(slots, conflictMap, false);

      // Touching at boundary is not overlap
      expect(filtered.length).toBe(1);
    });
  });
});