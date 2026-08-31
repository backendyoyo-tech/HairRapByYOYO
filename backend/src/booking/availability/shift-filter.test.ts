/**
 * Unit tests for Artist Shift & Day-Off Filter - D7.2
 */

import { describe, it, expect } from 'vitest';
import {
  filterByArtistShift,
  addExtraAvailabilitySlots,
  applyShiftAndDayOffFilter,
  ArtistShiftFilterConfig,
  TimeSlot,
} from './shift-filter.js';
import { generateCandidateSlots } from './slot-generator.js';

describe('D7.2 - Artist Shift & Day-Off Filter', () => {
  
  const createTestDate = () => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 7); // Future date
    return date;
  };

  const createTimeSlot = (hours: number, minutes: number, durationMinutes: number = 15): TimeSlot => {
    const startAt = new Date(createTestDate());
    startAt.setHours(hours, minutes, 0, 0);
    const endAt = new Date(startAt);
    endAt.setMinutes(endAt.getMinutes() + durationMinutes);
    return { startAt, endAt };
  };

  const createWorkSchedule = (startHour: number, startMinute: number, endHour: number, endMinute: number, isActive = true) => ({
    id: `schedule-${startHour}-${endHour}`,
    startTime: new Date(`1970-01-01T${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}:00`),
    endTime: new Date(`1970-01-01T${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}:00`),
    isActive,
  });

  const createException = (startHour: number | null, startMinute: number, endHour: number | null, endMinute: number, isAvailable: boolean) => ({
    id: `exception-${isAvailable}`,
    exceptionDate: createTestDate(),
    startTime: startHour !== null ? new Date(`1970-01-01T${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}:00`) : null,
    endTime: endHour !== null ? new Date(`1970-01-01T${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}:00`) : null,
    isAvailable,
  });

  describe('filterByArtistShift', () => {
    const testDate = createTestDate();
    const dayStart = new Date(testDate);
    dayStart.setHours(0, 0, 0, 0);
    
    const slots = generateCandidateSlots(testDate); // 09:00-21:00 default

    it('should keep slots within artist shift', () => {
      const config: ArtistShiftFilterConfig = {
        dayOfWeek: testDate.getDay(),
        workSchedules: [createWorkSchedule(10, 0, 19, 0)],
        scheduleExceptions: [],
      };

      const filtered = filterByArtistShift(slots, config);
      
      // All slots should be within 10:00-19:00
      filtered.forEach(slot => {
        expect(slot.startAt.getHours()).toBeGreaterThanOrEqual(10);
        expect(slot.endAt.getHours()).toBeLessThanOrEqual(19);
        if (slot.endAt.getHours() === 19) {
          expect(slot.endAt.getMinutes()).toBe(0);
        }
      });
    });

    it('should remove slots before shift start', () => {
      const config: ArtistShiftFilterConfig = {
        dayOfWeek: testDate.getDay(),
        workSchedules: [createWorkSchedule(14, 0, 20, 0)],
        scheduleExceptions: [],
      };

      const filtered = filterByArtistShift(slots, config);
      
      // No slots before 14:00
      filtered.forEach(slot => {
        expect(slot.startAt.getHours()).toBeGreaterThanOrEqual(14);
      });
    });

    it('should remove slots after shift end', () => {
      const config: ArtistShiftFilterConfig = {
        dayOfWeek: testDate.getDay(),
        workSchedules: [createWorkSchedule(10, 0, 16, 0)],
        scheduleExceptions: [],
      };

      const filtered = filterByArtistShift(slots, config);
      
      // No slots ending after 16:00
      filtered.forEach(slot => {
        expect(slot.endAt.getHours()).toBeLessThanOrEqual(16);
        if (slot.endAt.getHours() === 16) {
          expect(slot.endAt.getMinutes()).toBe(0);
        }
      });
    });

    it('should return empty array for full day-off exception', () => {
      const config: ArtistShiftFilterConfig = {
        dayOfWeek: testDate.getDay(),
        workSchedules: [createWorkSchedule(10, 0, 19, 0)],
        scheduleExceptions: [createException(null, 0, null, 0, false)], // Full day off
      };

      const filtered = filterByArtistShift(slots, config);
      expect(filtered).toEqual([]);
    });

    it('should remove slots blocked by partial exception', () => {
      const config: ArtistShiftFilterConfig = {
        dayOfWeek: testDate.getDay(),
        workSchedules: [createWorkSchedule(10, 0, 19, 0)],
        scheduleExceptions: [createException(14, 0, 16, 0, false)], // Unavailable 14:00-16:00
      };

      const filtered = filterByArtistShift(slots, config);
      
      // No slots should overlap with 14:00-16:00
      filtered.forEach(slot => {
        const slotStart = slot.startAt.getHours() * 60 + slot.startAt.getMinutes();
        const slotEnd = slot.endAt.getHours() * 60 + slot.endAt.getMinutes();
        const exceptionStart = 14 * 60;
        const exceptionEnd = 16 * 60;
        
        // Should not overlap with exception
        const overlaps = slotStart < exceptionEnd && slotEnd > exceptionStart;
        expect(overlaps).toBe(false);
      });
    });

    it('should keep slots outside partial exception', () => {
      const config: ArtistShiftFilterConfig = {
        dayOfWeek: testDate.getDay(),
        workSchedules: [createWorkSchedule(10, 0, 19, 0)],
        scheduleExceptions: [createException(14, 0, 16, 0, false)],
      };

      const filtered = filterByArtistShift(slots, config);
      
      // Should have slots before 14:00 and after 16:00
      const beforeException = filtered.filter(s => s.endAt.getHours() < 14 || (s.endAt.getHours() === 14 && s.endAt.getMinutes() === 0));
      const afterException = filtered.filter(s => s.startAt.getHours() > 16 || (s.startAt.getHours() === 16 && s.startAt.getMinutes() === 0));
      
      expect(beforeException.length).toBeGreaterThan(0);
      expect(afterException.length).toBeGreaterThan(0);
    });

    it('should ignore inactive work schedules', () => {
      const config: ArtistShiftFilterConfig = {
        dayOfWeek: testDate.getDay(),
        workSchedules: [
          createWorkSchedule(10, 0, 19, 0, false), // inactive
          createWorkSchedule(14, 0, 16, 0, true),  // active - only 2 hours
        ],
        scheduleExceptions: [],
      };

      const filtered = filterByArtistShift(slots, config);
      
      // Should only have slots from active schedule (14:00-16:00)
      filtered.forEach(slot => {
        expect(slot.startAt.getHours()).toBeGreaterThanOrEqual(14);
        expect(slot.endAt.getHours()).toBeLessThanOrEqual(16);
      });
    });

    it('should return empty when no active schedules', () => {
      const config: ArtistShiftFilterConfig = {
        dayOfWeek: testDate.getDay(),
        workSchedules: [createWorkSchedule(10, 0, 19, 0, false)],
        scheduleExceptions: [],
      };

      const filtered = filterByArtistShift(slots, config);
      expect(filtered).toEqual([]);
    });

    it('should handle split shifts (multiple active schedules)', () => {
      const config: ArtistShiftFilterConfig = {
        dayOfWeek: testDate.getDay(),
        workSchedules: [
          createWorkSchedule(10, 0, 13, 0, true),  // morning
          createWorkSchedule(15, 0, 19, 0, true),  // afternoon
        ],
        scheduleExceptions: [],
      };

      const filtered = filterByArtistShift(slots, config);
      
      // Should have slots in both morning and afternoon, but not in gap (13:00-15:00)
      const morningSlots = filtered.filter(s => s.endAt.getHours() < 13 || (s.endAt.getHours() === 13 && s.endAt.getMinutes() === 0));
      const afternoonSlots = filtered.filter(s => s.startAt.getHours() >= 15);
      
      expect(morningSlots.length).toBeGreaterThan(0);
      expect(afternoonSlots.length).toBeGreaterThan(0);
      
      // No slots should overlap the gap (13:00-15:00)
      // Gap overlap = slot starts before 15:00 AND ends after 13:00
      const gapOverlapSlots = filtered.filter(s => {
        const slotStartMinutes = s.startAt.getHours() * 60 + s.startAt.getMinutes();
        const slotEndMinutes = s.endAt.getHours() * 60 + s.endAt.getMinutes();
        const gapStart = 13 * 60; // 13:00 = 780
        const gapEnd = 15 * 60;   // 15:00 = 900
        return slotStartMinutes < gapEnd && slotEndMinutes > gapStart;
      });
      expect(gapOverlapSlots.length).toBe(0);
    });
  });

  describe('addExtraAvailabilitySlots', () => {
    const testDate = createTestDate();
    const dayStart = new Date(testDate);
    dayStart.setHours(0, 0, 0, 0);
    const slotIntervalMinutes = 15;
    const totalDurationMinutes = 60; // 1 hour service

    it('should add extra slots from isAvailable=true exception', () => {
      const baseSlots = generateCandidateSlots(testDate); // 09:00-21:00
      const exceptions = [createException(8, 0, 10, 0, true)]; // Extra 8:00-10:00
      
      const result = addExtraAvailabilitySlots(
        baseSlots,
        exceptions,
        dayStart,
        slotIntervalMinutes,
        totalDurationMinutes
      );
      
      // Should have original slots plus extra morning slots
      const extraMorningSlots = result.filter(s => s.startAt.getHours() < 9);
      expect(extraMorningSlots.length).toBeGreaterThan(0);
      
      // Extra slots should be within exception window (8:00-10:00)
      extraMorningSlots.forEach(slot => {
        expect(slot.startAt.getHours()).toBeGreaterThanOrEqual(8);
        expect(slot.endAt.getHours()).toBeLessThanOrEqual(10);
      });
    });

    it('should not add extra slots for unavailable exceptions', () => {
      const baseSlots = generateCandidateSlots(testDate);
      const exceptions = [createException(8, 0, 10, 0, false)]; // Unavailable
      
      const result = addExtraAvailabilitySlots(
        baseSlots,
        exceptions,
        dayStart,
        slotIntervalMinutes,
        totalDurationMinutes
      );
      
      // Should not add extra slots
      expect(result.length).toBe(baseSlots.length);
    });

    it('should not add extra slots for full-day exceptions (null times)', () => {
      const baseSlots = generateCandidateSlots(testDate);
      const exceptions = [createException(null, 0, null, 0, true)]; // Full day, but null times
      
      const result = addExtraAvailabilitySlots(
        baseSlots,
        exceptions,
        dayStart,
        slotIntervalMinutes,
        totalDurationMinutes
      );
      
      expect(result.length).toBe(baseSlots.length);
    });

    it('should not duplicate existing slots', () => {
      // Base slots include 10:00-21:00
      // Exception adds 10:00-12:00 (overlaps with base)
      const baseSlots = generateCandidateSlots(testDate);
      const exceptions = [createException(10, 0, 12, 0, true)];
      
      const result = addExtraAvailabilitySlots(
        baseSlots,
        exceptions,
        dayStart,
        slotIntervalMinutes,
        totalDurationMinutes
      );
      
      // Count unique start times
      const startTimes = result.map(s => s.startAt.getTime());
      const uniqueStartTimes = new Set(startTimes);
      expect(uniqueStartTimes.size).toBe(startTimes.length);
    });
  });

  describe('applyShiftAndDayOffFilter (complete pipeline)', () => {
    const testDate = createTestDate();
    const dayStart = new Date(testDate);
    dayStart.setHours(0, 0, 0, 0);
    const slotIntervalMinutes = 15;
    const totalDurationMinutes = 60;

    it('should filter by shift, apply exceptions, and add extra availability', () => {
      const config: ArtistShiftFilterConfig = {
        dayOfWeek: testDate.getDay(),
        workSchedules: [createWorkSchedule(10, 0, 19, 0)],
        scheduleExceptions: [
          createException(14, 0, 16, 0, false), // Unavailable 14:00-16:00
          createException(8, 0, 10, 0, true),   // Extra availability 8:00-10:00
        ],
      };

      const baseSlots = generateCandidateSlots(testDate); // 09:00-21:00
      
      const result = applyShiftAndDayOffFilter(
        baseSlots,
        config,
        dayStart,
        slotIntervalMinutes,
        totalDurationMinutes
      );

      // Should have:
      // - Extra slots from 8:00-10:00
      // - Shift slots from 10:00-19:00
      // - But NOT 14:00-16:00 (exception)
      // - Sorted by start time

      // Check extra morning slots exist
      const extraMorning = result.filter(s => s.startAt.getHours() < 10 && s.startAt.getHours() >= 8);
      expect(extraMorning.length).toBeGreaterThan(0);

      // Check shift slots exist
      const shiftSlots = result.filter(s => s.startAt.getHours() >= 10 && s.endAt.getHours() <= 19);
      expect(shiftSlots.length).toBeGreaterThan(0);

      // Check no slots in exception window (14:00-16:00)
      const exceptionSlots = result.filter(s => {
        const start = s.startAt.getHours() * 60 + s.startAt.getMinutes();
        const end = s.endAt.getHours() * 60 + s.endAt.getMinutes();
        return start < 16 * 60 && end > 14 * 60;
      });
      expect(exceptionSlots.length).toBe(0);

      // Check sorted by start time
      for (let i = 1; i < result.length; i++) {
        expect(result[i].startAt.getTime()).toBeGreaterThanOrEqual(result[i-1].startAt.getTime());
      }
    });

    it('should handle day-off exception correctly (full day off)', () => {
      const config: ArtistShiftFilterConfig = {
        dayOfWeek: testDate.getDay(),
        workSchedules: [createWorkSchedule(10, 0, 19, 0)],
        scheduleExceptions: [createException(null, 0, null, 0, false)],
      };

      const baseSlots = generateCandidateSlots(testDate);
      
      const result = applyShiftAndDayOffFilter(
        baseSlots,
        config,
        dayStart,
        slotIntervalMinutes,
        totalDurationMinutes
      );

      expect(result).toEqual([]);
    });
  });
});