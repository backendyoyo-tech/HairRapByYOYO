/**
 * Service Duration + 10-min Buffer Fit - D7.5
 * Ensures the complete service execution fits inside valid artist availability
 * with the approved 10-minute artist-only post-service buffer.
 */

import { TimeSlot } from './slot-generator.js';

export interface DurationFilterConfig {
  /** Total service duration in minutes (sum of all requested services) */
  totalServiceDurationMinutes: number;
  /** Artist buffer in minutes (authoritative: 10 minutes) */
  artistBufferMinutes: number;
  /** Slot interval in minutes (authoritative: 15) */
  slotIntervalMinutes: number;
}

/**
 * Default configuration per authoritative contracts
 * - 10-minute artist-only post-service buffer
 * - 15-minute slot interval
 */
export const DEFAULT_DURATION_CONFIG: DurationFilterConfig = {
  totalServiceDurationMinutes: 0, // Must be set per request
  artistBufferMinutes: 10,
  slotIntervalMinutes: 15,
};

/**
 * Calculates the total time needed for a service including buffer
 * The buffer is an artist scheduling constraint only - does not affect client-facing duration/pricing
 */
export function calculateTotalDurationWithBuffer(
  serviceDurationMinutes: number,
  bufferMinutes: number = 10
): number {
  return serviceDurationMinutes + bufferMinutes;
}

/**
 * Filters candidate slots to ensure the complete service + buffer fits
 * within the artist's valid availability window.
 * 
 * The buffer prevents another assignment starting before 10 minutes after
 * the service ends. It does NOT extend the client-facing service duration.
 */
export function filterByDurationAndBuffer(
  slots: TimeSlot[],
  validWindowStart: Date,
  validWindowEnd: Date,
  totalServiceDurationMinutes: number,
  bufferMinutes: number = 10
): TimeSlot[] {
  const totalDurationWithBuffer = totalServiceDurationMinutes + bufferMinutes;
  
  return slots.filter(slot => {
    const slotEndWithBuffer = new Date(slot.startAt.getTime() + totalDurationWithBuffer * 60000);
    
    // Service + buffer must fit within the valid window
    return slotEndWithBuffer <= validWindowEnd && slot.startAt >= validWindowStart;
  });
}

/**
 * Filters slots for a specific artist's shift window
 * Uses the artist's shift start/end as the valid window
 */
export function filterByArtistShiftWindow(
  slots: TimeSlot[],
  shiftStart: Date,
  shiftEnd: Date,
  totalServiceDurationMinutes: number,
  bufferMinutes: number = 10
): TimeSlot[] {
  return filterByDurationAndBuffer(
    slots,
    shiftStart,
    shiftEnd,
    // The service must finish by shiftEnd, buffer can extend beyond
    // Per contract: "The service execution itself must finish by shift_end. 
    // The 10-minute artist buffer prevents another assignment after the service,
    // but it does not extend the client service duration."
    totalServiceDurationMinutes,
    bufferMinutes
  );
}

/**
 * Checks if a service + buffer fits in a given window
 * Returns the maximum service duration that can fit in the window
 */
export function getMaxServiceDurationForWindow(
  windowStart: Date,
  windowEnd: Date,
  bufferMinutes: number = 10
): number {
  const windowMinutes = (windowEnd.getTime() - windowStart.getTime()) / (1000 * 60);
  return Math.max(0, windowMinutes - bufferMinutes); // Subtract buffer
}

/**
 * For multi-service bookings, calculates if all services + single buffer fit
 * The buffer is applied ONCE at the end of the complete service sequence
 * (not between services, unless same artist performs consecutive services)
 */
export function calculateMultiServiceDuration(
  serviceDurations: number[],
  sameArtistConsecutive: boolean = false,
  bufferMinutes: number = 10
): { totalServiceMinutes: number; totalWithBufferMinutes: number } {
  const totalServiceMinutes = serviceDurations.reduce((sum, d) => sum + d, 0);
  
  if (sameArtistConsecutive) {
    // If same artist does consecutive services, each transition needs buffer
    // For N services, there are N-1 transitions
    const transitionBuffers = (serviceDurations.length - 1) * bufferMinutes;
    const finalBuffer = bufferMinutes; // End of last service
    return {
      totalServiceMinutes,
      totalWithBufferMinutes: totalServiceMinutes + transitionBuffers + finalBuffer,
    };
  } else {
    // Different artists for each service - single buffer at end
    return {
      totalServiceMinutes,
      totalWithBufferMinutes: totalServiceMinutes + bufferMinutes,
    };
  }
}

/**
 * Filters slots for multi-service sequences
 * Each service in the sequence must fit with proper buffers
 */
export function filterMultiServiceSequence(
  slots: TimeSlot[],
  serviceDurations: number[],
  windowStart: Date,
  windowEnd: Date,
  sameArtistConsecutive: boolean = false,
  bufferMinutes: number = 10
): TimeSlot[] {
  const { totalWithBufferMinutes } = calculateMultiServiceDuration(
    serviceDurations,
    sameArtistConsecutive,
    bufferMinutes
  );
  
  return slots.filter(slot => {
    const sequenceEnd = new Date(slot.startAt.getTime() + totalWithBufferMinutes * 60000);
    return sequenceEnd <= windowEnd && slot.startAt >= windowStart;
  });
}

/**
 * For parallel services (Hair + Beauty), checks if they can run concurrently
 * Each service needs its own artist and window, but they share the same start time
 * Returns true if both can be accommodated in parallel
 */
export function canRunParallelServices(
  slot: TimeSlot,
  serviceDurations: number[],
  windowStart: Date,
  windowEnd: Date,
  bufferMinutes: number = 10
): boolean {
  // For parallel, each service runs independently with its own artist
  // The slot start time is the same for both
  // Each needs its own service duration + buffer
  const maxDuration = Math.max(...serviceDurations);
  const totalWithBuffer = maxDuration + bufferMinutes;
  
  const slotEnd = new Date(slot.startAt.getTime() + totalWithBuffer * 60000);
  return slotEnd <= windowEnd && slot.startAt >= windowStart;
}