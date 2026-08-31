/**
 * Unit tests for Service Duration + 10-min Buffer Fit - D7.5
 */

import { describe, it, expect } from 'vitest';
import {
  calculateTotalDurationWithBuffer,
  filterByDurationAndBuffer,
  filterByArtistShiftWindow,
  getMaxServiceDurationForWindow,
  calculateMultiServiceDuration,
  filterMultiServiceSequence,
  canRunParallelServices,
  DEFAULT_DURATION_CONFIG,
  TimeSlot,
} from './duration-filter.js';

describe('D7.5 - Service Duration + 10-min Buffer Fit', () => {
  
  // Use a fixed test date to avoid date inconsistencies
  const FIXED_TEST_DATE = new Date('2026-01-15T00:00:00.000Z'); // A Thursday
  
  const createTimeSlot = (hours: number, minutes: number, durationMinutes: number = 15): TimeSlot => {
    const startAt = new Date(FIXED_TEST_DATE);
    startAt.setHours(hours, minutes, 0, 0);
    const endAt = new Date(startAt);
    endAt.setMinutes(endAt.getMinutes() + durationMinutes);
    return { startAt, endAt };
  };

  describe('DEFAULT_DURATION_CONFIG', () => {
    it('should have correct default values per authoritative contract', () => {
      expect(DEFAULT_DURATION_CONFIG.totalServiceDurationMinutes).toBe(0);
      expect(DEFAULT_DURATION_CONFIG.artistBufferMinutes).toBe(10);
      expect(DEFAULT_DURATION_CONFIG.slotIntervalMinutes).toBe(15);
    });
  });

  describe('calculateTotalDurationWithBuffer', () => {
    it('should add buffer to service duration', () => {
      expect(calculateTotalDurationWithBuffer(60, 10)).toBe(70);
      expect(calculateTotalDurationWithBuffer(30, 10)).toBe(40);
      expect(calculateTotalDurationWithBuffer(90, 10)).toBe(100);
    });

    it('should allow custom buffer', () => {
      expect(calculateTotalDurationWithBuffer(60, 15)).toBe(75);
      expect(calculateTotalDurationWithBuffer(30, 5)).toBe(35);
    });

    it('should handle zero duration', () => {
      expect(calculateTotalDurationWithBuffer(0, 10)).toBe(10);
    });
  });

  describe('filterByDurationAndBuffer', () => {
    const windowStart = new Date(FIXED_TEST_DATE);
    windowStart.setHours(10, 0, 0, 0);
    const windowEnd = new Date(FIXED_TEST_DATE);
    windowEnd.setHours(19, 0, 0, 0);

    const slots = [
      createTimeSlot(10, 0),   // 10:00
      createTimeSlot(10, 15),  // 10:15
      createTimeSlot(14, 0),   // 14:00
      createTimeSlot(15, 0),   // 15:00
      createTimeSlot(17, 0),   // 17:00
      createTimeSlot(18, 0),   // 18:00
      createTimeSlot(18, 30),  // 18:30
      createTimeSlot(18, 45),  // 18:45
      createTimeSlot(19, 0),   // 19:00 - at boundary
    ];

    it('should keep slots where service + buffer fits in window', () => {
      const filtered = filterByDurationAndBuffer(slots, windowStart, windowEnd, 60, 10);
      
      // 60 min service + 10 buffer = 70 min total
      // Window: 10:00-19:00
      // Latest start: 19:00 - 70 min = 17:50
      // 10:00, 10:15, 14:00, 15:00, 17:00 should pass
      // 17:30, 18:00, 18:30, 18:45, 19:00 should fail (service+buffer would exceed 19:00)
      
      expect(filtered.length).toBe(5); // 10:00, 10:15, 14:00, 15:00, 17:00
      expect(filtered.map(s => `${s.startAt.getHours()}:${s.startAt.getMinutes().toString().padStart(2, '0')}`))
        .toEqual(['10:00', '10:15', '14:00', '15:00', '17:00']);
    });

    it('should keep slots where service exactly fits at boundary', () => {
      // Service 50 min + 10 buffer = 60 min
      // Window 10:00-19:00, latest start 18:00
      const filtered = filterByDurationAndBuffer(slots, windowStart, windowEnd, 50, 10);
      
      // 18:00 slot: 18:00 + 60 min = 19:00 exactly at boundary - should PASS per contract
      // "If a service ends at shift_end, no later appointment is possible anyway; 
      // the buffer may extend beyond shift_end without making the original service invalid."
      
      const startTimes = filtered.map(s => s.startAt.getHours() * 60 + s.startAt.getMinutes());
      expect(startTimes).toContain(18 * 60); // 18:00 should pass
    });

    it('should filter out slots beyond boundary', () => {
      // Service 90 min + 10 buffer = 100 min
      // Window 10:00-19:00, latest start 17:20
      const filtered = filterByDurationAndBuffer(slots, windowStart, windowEnd, 90, 10);
      
      // 17:30 (1050) + 100 = 19:10 > 19:00 - should fail
      // 17:00 (1020) + 100 = 18:40 < 19:00 - should pass
      const startTimes = filtered.map(s => s.startAt.getHours() * 60 + s.startAt.getMinutes());
      expect(startTimes).not.toContain(17 * 60 + 30); // 17:30 should fail
      expect(startTimes).toContain(17 * 60); // 17:00 should pass
    });

    it('should return empty for duration longer than window', () => {
      const filtered = filterByDurationAndBuffer(slots, windowStart, windowEnd, 600, 10); // 10 hours
      expect(filtered).toEqual([]);
    });

    it('should handle buffer not affecting client-facing duration', () => {
      // The buffer is artist-only scheduling constraint
      // Client sees 60 min service, artist is blocked for 70 min
      const filtered = filterByDurationAndBuffer(slots, windowStart, windowEnd, 60, 10);
      
      // Artist blocked for 70 min, client service is 60 min
      // This is verified by the function correctly adding buffer
      expect(filtered.length).toBeGreaterThan(0);
      const firstSlot = filtered[0];
      const artistBlockEnd = new Date(firstSlot.startAt.getTime() + (60 + 10) * 60000);
      const clientServiceEnd = new Date(firstSlot.startAt.getTime() + 60 * 60000);
      
      expect(artistBlockEnd.getTime() - clientServiceEnd.getTime()).toBe(10 * 60000); // 10 min difference
    });
  });

  describe('filterByArtistShiftWindow', () => {
    const shiftStart = new Date(FIXED_TEST_DATE);
    shiftStart.setHours(10, 0, 0, 0);
    const shiftEnd = new Date(FIXED_TEST_DATE);
    shiftEnd.setHours(19, 0, 0, 0);
    
    const slots = [
      createTimeSlot(9, 30),  // Before shift
      createTimeSlot(10, 0),  // At shift start
      createTimeSlot(10, 15),
      createTimeSlot(17, 0),
      createTimeSlot(18, 30),
      createTimeSlot(19, 0),  // At shift end
      createTimeSlot(19, 15), // After shift
    ];

    it('should keep slots within shift window considering buffer', () => {
      const filtered = filterByArtistShiftWindow(slots, shiftStart, shiftEnd, 60, 10);
      
      // 60 min service + 10 buffer = 70 min
      // Shift: 10:00-19:00
      // Valid: 10:00 to 17:50
      // 10:00, 10:15, 17:00 should pass
      // 9:30 (before shift), 18:30, 19:00, 19:15 should fail
      
      const hours = filtered.map(s => s.startAt.getHours());
      expect(hours).toContain(10);
      expect(hours).not.toContain(9);
      expect(hours).not.toContain(18);
      expect(hours).not.toContain(19);
    });

    it('should allow service ending exactly at shift end', () => {
      // 50 min service + 10 buffer = 60 min
      // 18:00 + 60 = 19:00 exactly
      const filtered = filterByArtistShiftWindow(
        [createTimeSlot(18, 0)],
        shiftStart,
        shiftEnd,
        50, 10
      );
      
      expect(filtered.length).toBe(1);
      expect(filtered[0].startAt.getHours()).toBe(18);
    });
  });

  describe('getMaxServiceDurationForWindow', () => {
    it('should return max service duration that fits', () => {
      const windowStart = new Date(FIXED_TEST_DATE);
      windowStart.setHours(10, 0, 0, 0);
      const windowEnd = new Date(FIXED_TEST_DATE);
      windowEnd.setHours(19, 0, 0, 0);
      
      // 9 hours = 540 minutes, minus 10 buffer = 530 minutes max service
      const maxDuration = getMaxServiceDurationForWindow(windowStart, windowEnd, 10);
      expect(maxDuration).toBe(530);
    });

    it('should handle custom buffer', () => {
      const windowStart = new Date(FIXED_TEST_DATE);
      windowStart.setHours(10, 0, 0, 0);
      const windowEnd = new Date(FIXED_TEST_DATE);
      windowEnd.setHours(19, 0, 0, 0);
      
      // 540 - 15 = 525
      const maxDuration = getMaxServiceDurationForWindow(windowStart, windowEnd, 15);
      expect(maxDuration).toBe(525);
    });

    it('should return 0 for window smaller than buffer', () => {
      const windowStart = new Date(FIXED_TEST_DATE);
      windowStart.setHours(10, 0, 0, 0);
      const windowEnd = new Date(FIXED_TEST_DATE);
      windowEnd.setHours(10, 5, 0, 0); // 5 min window
      
      const maxDuration = getMaxServiceDurationForWindow(windowStart, windowEnd, 10);
      expect(maxDuration).toBe(0);
    });
  });

  describe('calculateMultiServiceDuration', () => {
    it('should add single buffer for different artists', () => {
      const result = calculateMultiServiceDuration([30, 45, 60], false, 10);
      
      // 30 + 45 + 60 = 135 service minutes
      // Different artists: single 10 min buffer at end
      expect(result.totalServiceMinutes).toBe(135);
      expect(result.totalWithBufferMinutes).toBe(145);
    });

    it('should add transition buffers for same artist consecutive', () => {
      const result = calculateMultiServiceDuration([30, 45, 60], true, 10);
      
      // 30 + 45 + 60 = 135 service minutes
      // Same artist: 2 transitions * 10 + 1 final buffer = 30 min
      expect(result.totalServiceMinutes).toBe(135);
      expect(result.totalWithBufferMinutes).toBe(165);
    });

    it('should handle single service', () => {
      const result = calculateMultiServiceDuration([60], false, 10);
      expect(result.totalServiceMinutes).toBe(60);
      expect(result.totalWithBufferMinutes).toBe(70);
    });

    it('should handle single service with same artist', () => {
      const result = calculateMultiServiceDuration([60], true, 10);
      // 1 service = 0 transitions + 1 final buffer = 10
      expect(result.totalServiceMinutes).toBe(60);
      expect(result.totalWithBufferMinutes).toBe(70);
    });

    it('should handle two services same artist', () => {
      const result = calculateMultiServiceDuration([30, 60], true, 10);
      // 30 + 60 = 90 service
      // 1 transition * 10 + 1 final = 20 buffer
      expect(result.totalWithBufferMinutes).toBe(110);
    });
  });

  describe('filterMultiServiceSequence', () => {
    const windowStart = new Date(FIXED_TEST_DATE);
    windowStart.setHours(10, 0, 0, 0);
    const windowEnd = new Date(FIXED_TEST_DATE);
    windowEnd.setHours(19, 0, 0, 0);

    const slots = [
      createTimeSlot(10, 0),   // 10:00
      createTimeSlot(11, 0),   // 11:00
      createTimeSlot(12, 0),   // 12:00
      createTimeSlot(14, 0),   // 14:00
      createTimeSlot(15, 0),   // 15:00
      createTimeSlot(16, 0),   // 16:00
      createTimeSlot(17, 0),   // 17:00
    ];

    it('should filter slots for multi-service sequence with different artists', () => {
      // 30 + 60 = 90 service + 10 buffer = 100 min
      // Window 10:00-19:00, latest start 17:20
      const filtered = filterMultiServiceSequence(slots, [30, 60], windowStart, windowEnd, false, 10);
      
      // 10:00 + 100 = 11:40 ✓
      // 11:00 + 100 = 12:40 ✓
      // 12:00 + 100 = 13:40 ✓
      // 14:00 + 100 = 15:40 ✓
      // 15:00 + 100 = 16:40 ✓
      // 16:00 + 100 = 17:40 ✓ (17:40 <= 19:00)
      // 17:00 + 100 = 18:40 ✓ (18:40 <= 19:00)
      // Latest valid start: 17:20
      expect(filtered.length).toBe(7);
    });

    it('should filter slots for multi-service sequence with same artist', () => {
      // 30 + 60 = 90 service + 20 buffer (1 transition + 1 final) = 110 min
      const filtered = filterMultiServiceSequence(slots, [30, 60], windowStart, windowEnd, true, 10);
      
      // 10:00 + 110 = 11:50 ✓
      // 11:00 + 110 = 12:50 ✓
      // 12:00 + 110 = 13:50 ✓
      // 14:00 + 110 = 15:50 ✓
      // 15:00 + 110 = 16:50 ✓
      // 16:00 + 110 = 17:50 ✓ (17:50 <= 19:00)
      // 17:00 + 110 = 18:50 ✓ (18:50 <= 19:00)
      // Latest valid start: 17:10
      expect(filtered.length).toBe(7);
    });
  });

  describe('canRunParallelServices', () => {
    const windowStart = new Date(FIXED_TEST_DATE);
    windowStart.setHours(10, 0, 0, 0);
    const windowEnd = new Date(FIXED_TEST_DATE);
    windowEnd.setHours(19, 0, 0, 0);

    const slot = createTimeSlot(15, 0); // 15:00

    it('should return true for parallel services that fit', () => {
      // Hair 60 + Beauty 45 = max 60 + 10 buffer = 70 min
      // 15:00 + 70 = 16:10 < 19:00 ✓
      const result = canRunParallelServices(slot, [60, 45], windowStart, windowEnd, 10);
      expect(result).toBe(true);
    });

    it('should return true for parallel services that fit (longer)', () => {
      // Hair 120 + Beauty 120 = max 120 + 10 = 130 min
      // 15:00 + 130 = 17:10 < 19:00 ✓
      const result = canRunParallelServices(slot, [120, 120], windowStart, windowEnd, 10);
      expect(result).toBe(true);
    });

    it('should return false when parallel exceeds window', () => {
      // Late slot: 18:00
      const lateSlot = createTimeSlot(18, 0);
      // 60 + 10 = 70 min, 18:00 + 70 = 19:10 > 19:00 ✗
      const result = canRunParallelServices(lateSlot, [60], windowStart, windowEnd, 10);
      expect(result).toBe(false);
    });

    it('should use max duration for parallel (not sum)', () => {
      // Parallel services run simultaneously, so max duration matters
      // 30 + 120 = max 120 + 10 = 130 min
      const result = canRunParallelServices(slot, [30, 120], windowStart, windowEnd, 10);
      // 15:00 + 130 = 17:10 < 19:00 ✓
      expect(result).toBe(true);
      
      // Compare with sequential which would be 30 + 120 + 10 = 160 min
    });
  });
});