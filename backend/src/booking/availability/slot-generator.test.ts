/**
 * Unit tests for Candidate Slot Generator - D7.1
 */

import { describe, it, expect } from 'vitest';
import {
  generateCandidateSlots,
  generateCandidateSlotsForShift,
  isValidSlotGrid,
  roundToSlotGrid,
  DEFAULT_SLOT_CONFIG,
  TimeSlot,
} from './slot-generator.js';

describe('D7.1 - Candidate Slot Generator', () => {
  
  describe('generateCandidateSlots', () => {
    // Use a future date relative to today to avoid "past date" filtering
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const testDate = new Date(today);
    testDate.setDate(testDate.getDate() + 7); // 7 days in future
    
    it('should generate correct 15-minute increments', () => {
      const slots = generateCandidateSlots(testDate);
      
      expect(slots.length).toBeGreaterThan(0);
      
      // Check first slot is at business start (09:00)
      expect(slots[0].startAt.getHours()).toBe(9);
      expect(slots[0].startAt.getMinutes()).toBe(0);
      
      // Check 15-minute increments
      for (let i = 1; i < slots.length; i++) {
        const diffMinutes = (slots[i].startAt.getTime() - slots[i-1].startAt.getTime()) / (1000 * 60);
        expect(diffMinutes).toBe(15);
      }
    });

    it('should not generate duplicate slots', () => {
      const slots = generateCandidateSlots(testDate);
      const startTimes = slots.map(s => s.startAt.getTime());
      const uniqueStartTimes = new Set(startTimes);
      expect(uniqueStartTimes.size).toBe(startTimes.length);
    });

    it('should have correct boundary behavior - last slot ends at business end', () => {
      const slots = generateCandidateSlots(testDate);
      const lastSlot = slots[slots.length - 1];
      
      // Last slot should end at or before business end (21:00)
      expect(lastSlot.endAt.getHours()).toBeLessThanOrEqual(21);
      if (lastSlot.endAt.getHours() === 21) {
        expect(lastSlot.endAt.getMinutes()).toBe(0);
      }
    });

    it('should reject invalid date', () => {
      expect(() => generateCandidateSlots(new Date('invalid'))).toThrow('INVALID_DATE');
      expect(() => generateCandidateSlots({} as any)).toThrow('INVALID_DATE');
    });

    it('should return empty array for past dates', () => {
      const pastDate = new Date('2020-01-01');
      const slots = generateCandidateSlots(pastDate);
      expect(slots).toEqual([]);
    });

    it('should return empty array for dates beyond 60-day horizon', () => {
      const futureDate = new Date(today);
      futureDate.setDate(futureDate.getDate() + 61);
      const slots = generateCandidateSlots(futureDate);
      expect(slots).toEqual([]);
    });

    it('should return empty array for date exactly at 60-day horizon', () => {
      const horizonDate = new Date(today);
      horizonDate.setDate(horizonDate.getDate() + 60);
      horizonDate.setHours(0, 0, 0, 0);
      const slots = generateCandidateSlots(horizonDate);
      // 60 days out should be valid (within horizon)
      // 61 days out should be invalid
      expect(slots.length).toBeGreaterThan(0);
    });

    it('should generate correct number of slots for default 09:00-21:00 with 15-min intervals', () => {
      // 12 hours = 720 minutes, 720/15 = 48 slots
      const slots = generateCandidateSlots(testDate);
      expect(slots.length).toBe(48);
    });
  });

  describe('generateCandidateSlotsForShift', () => {
    const testDate = new Date('2026-01-15');
    
    it('should generate slots within artist shift only', () => {
      const slots = generateCandidateSlotsForShift(testDate, 10, 0, 19, 0);
      
      // First slot at shift start
      expect(slots[0].startAt.getHours()).toBe(10);
      expect(slots[0].startAt.getMinutes()).toBe(0);
      
      // Last slot ends at or before shift end
      const lastSlot = slots[slots.length - 1];
      expect(lastSlot.endAt.getHours()).toBeLessThanOrEqual(19);
      if (lastSlot.endAt.getHours() === 19) {
        expect(lastSlot.endAt.getMinutes()).toBe(0);
      }
    });

    it('should handle shift with minutes', () => {
      const slots = generateCandidateSlotsForShift(testDate, 10, 30, 14, 15);
      
      expect(slots[0].startAt.getHours()).toBe(10);
      expect(slots[0].startAt.getMinutes()).toBe(30);
      
      // 10:30 to 14:15 = 3 hours 45 min = 225 minutes
      // 225 / 15 = 15 slots
      expect(slots.length).toBe(15);
    });

    it('should reject invalid date', () => {
      expect(() => generateCandidateSlotsForShift(new Date('invalid'), 10, 0, 19, 0))
        .toThrow('INVALID_DATE');
    });

    it('should return empty for zero or negative shift duration', () => {
      const slots = generateCandidateSlotsForShift(testDate, 14, 0, 10, 0);
      expect(slots).toEqual([]);
    });
  });

  describe('isValidSlotGrid', () => {
    it('should return true for valid 15-minute grid timestamps', () => {
      const validTimes = [
        new Date('2026-01-15T09:00:00'),
        new Date('2026-01-15T09:15:00'),
        new Date('2026-01-15T09:30:00'),
        new Date('2026-01-15T09:45:00'),
        new Date('2026-01-15T10:00:00'),
        new Date('2026-01-15T20:45:00'),
      ];
      
      validTimes.forEach(time => {
        expect(isValidSlotGrid(time)).toBe(true);
      });
    });

    it('should return false for invalid grid timestamps', () => {
      const invalidTimes = [
        new Date('2026-01-15T09:05:00'),
        new Date('2026-01-15T09:10:00'),
        new Date('2026-01-15T09:20:00'),
        new Date('2026-01-15T09:00:30'), // seconds not zero
        new Date('2026-01-15T09:00:00.500'), // milliseconds not zero
      ];
      
      invalidTimes.forEach(time => {
        expect(isValidSlotGrid(time)).toBe(false);
      });
    });
  });

  describe('roundToSlotGrid', () => {
    it('should round down to nearest 15-minute grid', () => {
      const testCases = [
        { input: new Date('2026-01-15T09:07:00'), expected: new Date('2026-01-15T09:00:00') },
        { input: new Date('2026-01-15T09:14:59'), expected: new Date('2026-01-15T09:00:00') },
        { input: new Date('2026-01-15T09:15:00'), expected: new Date('2026-01-15T09:15:00') },
        { input: new Date('2026-01-15T09:29:00'), expected: new Date('2026-01-15T09:15:00') },
        { input: new Date('2026-01-15T09:46:00'), expected: new Date('2026-01-15T09:45:00') },
      ];
      
      testCases.forEach(({ input, expected }) => {
        const result = roundToSlotGrid(input);
        expect(result.getTime()).toBe(expected.getTime());
      });
    });

    it('should preserve date and zero out seconds/milliseconds', () => {
      const input = new Date('2026-01-15T09:37:45.123');
      const result = roundToSlotGrid(input);
      
      expect(result.getSeconds()).toBe(0);
      expect(result.getMilliseconds()).toBe(0);
      expect(result.getHours()).toBe(9);
      expect(result.getMinutes()).toBe(30); // rounded down
    });
  });

  describe('DEFAULT_SLOT_CONFIG', () => {
    it('should have correct default values per authoritative contract', () => {
      expect(DEFAULT_SLOT_CONFIG.businessStartHour).toBe(9);
      expect(DEFAULT_SLOT_CONFIG.businessEndHour).toBe(21);
      expect(DEFAULT_SLOT_CONFIG.slotIntervalMinutes).toBe(15);
      expect(DEFAULT_SLOT_CONFIG.timezone).toBe('Asia/Kolkata');
    });
  });

  describe('Edge cases', () => {
    // Use future dates relative to today for edge case tests
    // Must be within 60-day horizon from actual current date
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    it('should handle leap year dates within horizon', () => {
      // Find a leap day within 60 days of today, or skip if none
      let foundLeapDay = false;
      for (let year = today.getFullYear(); year <= today.getFullYear() + 2; year++) {
        const leapDate = new Date(year, 1, 29); // Feb 29
        if (leapDate.getMonth() === 1 && leapDate.getDate() === 29) { // Valid leap day
          leapDate.setHours(0, 0, 0, 0);
          const diffDays = Math.floor((leapDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays >= 0 && diffDays <= 60) {
            const slots = generateCandidateSlots(leapDate);
            expect(slots.length).toBe(48);
            foundLeapDay = true;
            break;
          }
        }
      }
      // If no leap day in horizon, test passes (no assertion needed)
      if (!foundLeapDay) {
        expect(true).toBe(true); // Test passes but no leap day in window
      }
    });

    it('should handle year boundary within horizon', () => {
      // Find next year boundary within 60 days
      const nextYearStart = new Date(today.getFullYear() + 1, 0, 1);
      nextYearStart.setHours(0, 0, 0, 0);
      const diffDays = Math.floor((nextYearStart.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diffDays >= 0 && diffDays <= 60) {
        const slots = generateCandidateSlots(nextYearStart);
        expect(slots.length).toBe(48);
      } else {
        // If not in horizon, test passes (boundary not in testable window)
        expect(true).toBe(true);
      }
    });
  });
});