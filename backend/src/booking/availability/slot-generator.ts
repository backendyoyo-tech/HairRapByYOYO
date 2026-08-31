/**
 * Candidate Slot Generator - D7.1
 * Generates valid candidate appointment start times at 15-minute intervals
 * using authoritative business boundaries.
 */

export interface TimeSlot {
  startAt: Date;
  endAt: Date;
}

export interface SlotGenerationConfig {
  /** Salon business start hour (0-23) in local time */
  businessStartHour: number;
  /** Salon business end hour (0-23) in local time */
  businessEndHour: number;
  /** Slot interval in minutes (authoritative: 15) */
  slotIntervalMinutes: number;
  /** Timezone for business hours (authoritative: Asia/Kolkata) */
  timezone: string;
}

/**
 * Default configuration per authoritative contracts
 * - 15-minute slot grid
 * - Business hours from salon_settings (configurable, defaults to 09:00-21:00)
 */
export const DEFAULT_SLOT_CONFIG: SlotGenerationConfig = {
  businessStartHour: 9,   // 09:00
  businessEndHour: 21,    // 21:00
  slotIntervalMinutes: 15,
  timezone: 'Asia/Kolkata',
};

/**
 * Generates candidate appointment start times at 15-minute intervals
 * for a given date within business hours.
 *
 * @param date - The date for which to generate slots (time component ignored)
 * @param config - Slot generation configuration (uses defaults if not provided)
 * @returns Array of TimeSlot objects with startAt and endAt as Date objects
 */
export function generateCandidateSlots(
  date: Date,
  config: Partial<SlotGenerationConfig> = {}
): TimeSlot[] {
  const cfg = { ...DEFAULT_SLOT_CONFIG, ...config };
  
  // Validate date
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new Error('INVALID_DATE: Provided date is not a valid Date object');
  }

  // Create date at start of day in local timezone
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);

  // Check if date is in the past (before today at 00:00)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (dayStart < today) {
    return []; // Past dates return empty slots per contract
  }

  // Check 60-day horizon
  const horizonLimit = new Date(today);
  horizonLimit.setDate(horizonLimit.getDate() + 60);
  if (dayStart > horizonLimit) {
    return []; // Beyond 60-day horizon returns empty slots
  }

  const slots: TimeSlot[] = [];
  
  // Generate slots from business start to business end
  const startMinutes = cfg.businessStartHour * 60;
  const endMinutes = cfg.businessEndHour * 60;
  const interval = cfg.slotIntervalMinutes;

  for (let minutes = startMinutes; minutes < endMinutes; minutes += interval) {
    const slotStart = new Date(dayStart);
    slotStart.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    
    const slotEnd = new Date(slotStart);
    slotEnd.setMinutes(slotEnd.getMinutes() + interval);

    // Ensure slot doesn't exceed business end time
    if (slotEnd.getTime() <= dayStart.getTime() + endMinutes * 60 * 1000) {
      slots.push({
        startAt: slotStart,
        endAt: slotEnd,
      });
    }
  }

  return slots;
}

/**
 * Generates candidate slots for a specific artist's shift on a given date
 * Used when artist-specific search is requested
 */
export function generateCandidateSlotsForShift(
  date: Date,
  shiftStartHour: number,
  shiftStartMinute: number,
  shiftEndHour: number,
  shiftEndMinute: number,
  config: Partial<SlotGenerationConfig> = {}
): TimeSlot[] {
  const cfg = { ...DEFAULT_SLOT_CONFIG, ...config };
  
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new Error('INVALID_DATE: Provided date is not a valid Date object');
  }

  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);

  const slots: TimeSlot[] = [];
  
  const startTotalMinutes = shiftStartHour * 60 + shiftStartMinute;
  const endTotalMinutes = shiftEndHour * 60 + shiftEndMinute;
  const interval = cfg.slotIntervalMinutes;

  for (let minutes = startTotalMinutes; minutes < endTotalMinutes; minutes += interval) {
    const slotStart = new Date(dayStart);
    slotStart.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    
    const slotEnd = new Date(slotStart);
    slotEnd.setMinutes(slotEnd.getMinutes() + interval);

    if (slotEnd.getTime() <= dayStart.getTime() + endTotalMinutes * 60 * 1000) {
      slots.push({
        startAt: slotStart,
        endAt: slotEnd,
      });
    }
  }

  return slots;
}

/**
 * Validates that a given timestamp aligns to the 15-minute grid
 */
export function isValidSlotGrid(timestamp: Date, intervalMinutes: number = 15): boolean {
  const minutes = timestamp.getMinutes();
  return minutes % intervalMinutes === 0 && timestamp.getSeconds() === 0 && timestamp.getMilliseconds() === 0;
}

/**
 * Rounds a timestamp down to the nearest 15-minute grid
 */
export function roundToSlotGrid(timestamp: Date, intervalMinutes: number = 15): Date {
  const rounded = new Date(timestamp);
  const minutes = rounded.getMinutes();
  const remainder = minutes % intervalMinutes;
  rounded.setMinutes(minutes - remainder, 0, 0);
  return rounded;
}