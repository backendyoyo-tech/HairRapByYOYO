/**
 * Artist Shift & Day-Off Filter - D7.2
 * Filters candidate slots against artist's weekly schedule and recurring day-offs
 */

import { TimeSlot } from './slot-generator.js';

export interface ArtistShiftFilterConfig {
  /** Day of week (0=Sunday, 1=Monday, ..., 6=Saturday) */
  dayOfWeek: number;
  /** Artist's work schedules for this day */
  workSchedules: Array<{
    id: string;
    startTime: Date; // Time component only
    endTime: Date;   // Time component only
    isActive: boolean;
  }>;
  /** Artist's schedule exceptions for this day */
  scheduleExceptions: Array<{
    id: string;
    exceptionDate: Date;
    startTime: Date | null; // null = full day off
    endTime: Date | null;   // null = full day off
    isAvailable: boolean;   // false = day off/unavailable, true = extra availability
  }>;
}

/**
 * Filters candidate slots by artist's shift schedule and day-offs
 * 
 * @param slots - Candidate slots from D7.1 generator
 * @param config - Artist shift filter configuration
 * @returns Filtered slots that fall within artist's working hours and are not on day-off
 */
export function filterByArtistShift(
  slots: TimeSlot[],
  config: ArtistShiftFilterConfig
): TimeSlot[] {
  const { workSchedules, scheduleExceptions } = config;
  
  // Check for full day-off exception (isAvailable=false, startTime=null, endTime=null)
  const fullDayOff = scheduleExceptions.find(
    e => !e.isAvailable && e.startTime === null && e.endTime === null
  );
  
  if (fullDayOff) {
    return []; // Artist has full day off - no slots available
  }
  
  // Filter out inactive schedules
  const activeSchedules = workSchedules.filter(s => s.isActive);
  
  if (activeSchedules.length === 0) {
    return []; // No active schedules for this day
  }
  
  // For each slot, check if it falls within any active schedule
  // and is not blocked by a partial exception
  return slots.filter(slot => {
    // Check if slot falls within any active work schedule
    const inSchedule = activeSchedules.some(schedule => {
      const slotStartMinutes = slot.startAt.getHours() * 60 + slot.startAt.getMinutes();
      const slotEndMinutes = slot.endAt.getHours() * 60 + slot.endAt.getMinutes();
      const scheduleStartMinutes = schedule.startTime.getHours() * 60 + schedule.startTime.getMinutes();
      const scheduleEndMinutes = schedule.endTime.getHours() * 60 + schedule.endTime.getMinutes();
      
      // Slot must be fully within schedule (start >= scheduleStart AND end <= scheduleEnd)
      return slotStartMinutes >= scheduleStartMinutes && slotEndMinutes <= scheduleEndMinutes;
    });
    
    if (!inSchedule) {
      return false; // Slot is outside all active schedules
    }
    
    // Check for partial exceptions that block this slot
    const blockedByException = scheduleExceptions.some(exception => {
      // Skip full day off (already handled) and extra availability exceptions
      if (exception.isAvailable) return false;
      if (exception.startTime === null || exception.endTime === null) return false;
      
      const exceptionStartMinutes = exception.startTime.getHours() * 60 + exception.startTime.getMinutes();
      const exceptionEndMinutes = exception.endTime.getHours() * 60 + exception.endTime.getMinutes();
      const slotStartMinutes = slot.startAt.getHours() * 60 + slot.startAt.getMinutes();
      const slotEndMinutes = slot.endAt.getHours() * 60 + slot.endAt.getMinutes();
      
      // Check if slot overlaps with unavailable exception
      return slotStartMinutes < exceptionEndMinutes && slotEndMinutes > exceptionStartMinutes;
    });
    
    return !blockedByException;
  });
}

/**
 * Adds extra availability slots from isAvailable=true exceptions
 * These are temporary working overrides that extend beyond normal shift
 */
export function addExtraAvailabilitySlots(
  slots: TimeSlot[],
  scheduleExceptions: ArtistShiftFilterConfig['scheduleExceptions'],
  dayStart: Date,
  slotIntervalMinutes: number,
  totalDurationMinutes: number
): TimeSlot[] {
  const extraSlots: TimeSlot[] = [];
  
  for (const exception of scheduleExceptions) {
    // Only process extra availability exceptions (isAvailable=true with times)
    if (!exception.isAvailable || !exception.startTime || !exception.endTime) {
      continue;
    }
    
    const excStart = new Date(dayStart);
    excStart.setHours(
      exception.startTime.getHours(),
      exception.startTime.getMinutes(),
      0,
      0
    );
    
    const excEnd = new Date(dayStart);
    excEnd.setHours(
      exception.endTime.getHours(),
      exception.endTime.getMinutes(),
      0,
      0
    );
    
    // Generate slots within this extra availability window
    let slotStart = new Date(excStart);
    while (slotStart < excEnd) {
      const slotEnd = new Date(slotStart.getTime() + totalDurationMinutes * 60000);
      
      if (slotEnd > excEnd) break;
      
      // Check if slot already exists (avoid duplicates with regular schedule slots)
      const alreadyExists = slots.some(s => s.startAt.getTime() === slotStart.getTime());
      if (!alreadyExists) {
        extraSlots.push({
          startAt: new Date(slotStart),
          endAt: new Date(slotEnd),
        });
      }
      
      slotStart = new Date(slotStart.getTime() + slotIntervalMinutes * 60000);
    }
  }
  
  return [...slots, ...extraSlots];
}

/**
 * Complete shift filter pipeline combining all D7.2 rules
 */
export function applyShiftAndDayOffFilter(
  slots: TimeSlot[],
  config: ArtistShiftFilterConfig,
  dayStart: Date,
  slotIntervalMinutes: number,
  totalDurationMinutes: number
): TimeSlot[] {
  // Step 1: Filter by active shifts and day-offs
  let filtered = filterByArtistShift(slots, config);
  
  // Step 2: Add extra availability from isAvailable=true exceptions
  filtered = addExtraAvailabilitySlots(
    filtered,
    config.scheduleExceptions,
    dayStart,
    slotIntervalMinutes,
    totalDurationMinutes
  );
  
  // Step 3: Sort by start time
  filtered.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  
  return filtered;
}