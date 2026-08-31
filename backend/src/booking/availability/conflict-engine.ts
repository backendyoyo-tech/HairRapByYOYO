/**
 * Existing Commitment Conflict Engine - D7.6
 * Prevents double-booking by checking existing commitments against candidate slots
 * Uses dependency injection for testability
 */

import { PrismaClient } from "../generated/prisma/client.js";
import { TimeSlot } from './slot-generator.js';

export interface ConflictConfig {
  /** Date to check for conflicts */
  date: Date;
  /** Service IDs being requested */
  serviceIds: string[];
  /** Total service duration + buffer in minutes */
  totalDurationWithBuffer: number;
  /** Optional specific artist ID */
  requestedArtistId?: string;
  /** Slot interval in minutes */
  slotIntervalMinutes: number;
}

/**
 * Booking statuses that block availability (from Booking State Machine)
 */
export const BLOCKING_BOOKING_STATUSES = [
  'CONFIRMED',
  'CHECKED_IN',
  'IN_SERVICE',
] as const;

/**
 * Assignment statuses that block availability
 */
export const BLOCKING_ASSIGNMENT_STATUSES = [
  'PENDING',
  'CONFIRMED',
] as const;

/**
 * Hold statuses that block availability
 */
export const BLOCKING_HOLD_STATUSES = [
  'HOLD_ACTIVE',
] as const;

/**
 * Checks if a time slot overlaps with any blocked interval
 */
export function hasOverlap(
  slotStart: Date,
  slotEnd: Date,
  blockedStart: Date,
  blockedEnd: Date
): boolean {
  return slotStart < blockedEnd && blockedStart < slotEnd;
}

/**
 * Creates conflict engine functions with a Prisma client
 * Uses dependency injection for testability
 */
export function createConflictEngine(prisma: PrismaClient) {
  
  /**
   * Gets existing bookings that overlap with the given date
   */
  async function getConflictingBookings(
    date: Date,
    requestedArtistId?: string
  ) {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const whereClause: any = {
      plannedStartAt: { lt: dayEnd },
      plannedEndAt: { gt: dayStart },
      booking: {
        status: { in: ['CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'] },
      },
    };

    if (requestedArtistId) {
      whereClause.OR = [
        { artistId: requestedArtistId },
        { requestedArtistId: requestedArtistId },
      ];
    }

    return prisma.bookingService.findMany({
      where: whereClause,
      select: {
        id: true,
        artistId: true,
        requestedArtistId: true,
        plannedStartAt: true,
        plannedEndAt: true,
        bookingId: true,
        booking: {
          select: { status: true },
        },
      },
    });
  }

  /**
   * Gets existing assignments that overlap with the given date
   */
  async function getConflictingAssignments(
    date: Date,
    requestedArtistId?: string
  ) {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const bookingServices = await prisma.bookingService.findMany({
      where: {
        plannedStartAt: { lt: dayEnd },
        plannedEndAt: { gt: dayStart },
        booking: { status: { in: ['CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'] } },
      },
      select: { id: true },
    });

    const bookingServiceIds = bookingServices.map((bs) => bs.id);

    const whereClause: any = {
      bookingServiceId: { in: bookingServiceIds },
      status: { in: ['PENDING', 'CONFIRMED'] },
    };

    if (requestedArtistId) {
      whereClause.artistId = requestedArtistId;
    }

    return prisma.bookingServiceAssignment.findMany({
      where: whereClause,
      select: {
        bookingServiceId: true,
        artistId: true,
        status: true,
      },
    });
  }

  /**
   * Gets active holds that overlap with the given date
   */
  async function getConflictingHolds(
    date: Date,
    requestedArtistId?: string
  ) {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const whereClause: any = {
      startAt: { lt: dayEnd },
      endAt: { gt: dayStart },
      hold: { status: 'HOLD_ACTIVE' },
    };

    if (requestedArtistId) {
      whereClause.artistId = requestedArtistId;
    }

    return prisma.bookingHoldResource.findMany({
      where: whereClause,
      include: {
        hold: { select: { status: true, expiresAt: true } },
      },
    });
  }

  /**
   * Builds a map of artistId -> blocked intervals for a given date
   */
  async function buildArtistConflictMap(
    date: Date,
    requestedArtistId?: string,
    slotIntervalMinutes: number = 15
  ): Promise<Map<string, Array<{ start: Date; end: Date }>>> {
    const [bookings, assignments, holds] = await Promise.all([
      getConflictingBookings(date, requestedArtistId),
      getConflictingAssignments(date, requestedArtistId),
      getConflictingHolds(date, requestedArtistId),
    ]);

    const conflictMap = new Map<string, Array<{ start: Date; end: Date }>>();

    // Add holds (block specific artist or anonymous capacity)
    for (const hold of holds) {
      if (hold.hold.expiresAt && new Date() > hold.hold.expiresAt) {
        continue; // Skip expired holds
      }
      
      const artistId = hold.artistId || 'ANONYMOUS_CAPACITY';
      const intervals = conflictMap.get(artistId) || [];
      intervals.push({ start: hold.startAt, end: hold.endAt });
      conflictMap.set(artistId, intervals);
    }

    // Add bookings with assignments
    for (const booking of bookings) {
      let blockedArtistIds: string[] = [];
      
      const bookingAssignments = assignments.filter((a) => a.bookingServiceId === booking.id);

      if (bookingAssignments.length > 0) {
        blockedArtistIds = bookingAssignments.map((a) => a.artistId);
      } else if (booking.requestedArtistId) {
        blockedArtistIds = [booking.requestedArtistId];
      } else {
        blockedArtistIds = ['ANONYMOUS_CAPACITY'];
      }

      for (const artistId of blockedArtistIds) {
        const intervals = conflictMap.get(artistId) || [];
        intervals.push({ start: booking.plannedStartAt, end: booking.plannedEndAt });
        conflictMap.set(artistId, intervals);
      }
    }

    return conflictMap;
  }

  /**
   * Checks if a specific slot has any conflicts for a given artist
   */
  async function hasSlotConflict(
    artistId: string,
    slotStart: Date,
    slotEnd: Date,
    date: Date,
    excludeHoldId?: string
  ): Promise<boolean> {
    const dayStart = new Date(slotStart);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    // Check holds
    const holdWhere: any = {
      artistId,
      startAt: { lt: slotEnd },
      endAt: { gt: slotStart },
      hold: { status: 'HOLD_ACTIVE', expiresAt: { gt: new Date() } },
    };
    
    if (excludeHoldId) {
      holdWhere.hold.id = { not: excludeHoldId };
    }

    const holdConflict = await prisma.bookingHoldResource.findFirst({ where: holdWhere, include: { hold: true } });
    if (holdConflict && holdConflict.hold && (!holdConflict.hold.expiresAt || holdConflict.hold.expiresAt > new Date())) {
      return true;
    }

    // Check bookings
    const bookingConflict = await prisma.bookingService.findFirst({
      where: {
        artistId,
        plannedStartAt: { lt: slotEnd },
        plannedEndAt: { gt: slotStart },
        booking: { status: { in: ['CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'] } },
      },
    });
    if (bookingConflict) return true;

    // Check assignments
    const assignmentConflict = await prisma.bookingServiceAssignment.findFirst({
      where: {
        artistId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        bookingService: {
          plannedStartAt: { lt: slotEnd },
          plannedEndAt: { gt: slotStart },
          booking: { status: { in: ['CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'] } },
        },
      },
    });
    if (assignmentConflict) return true;

    return false;
  }

  /**
   * Filters candidate slots by removing those with conflicts
   * Uses the artist conflict map for efficiency
   */
  function filterSlotsByConflicts(
    slots: Array<{ artistId: string; startAt: Date; endAt: Date }>,
    conflictMap: Map<string, Array<{ start: Date; end: Date }>>,
    includeAnonymousCapacity: boolean = true
  ): Array<{ artistId: string; startAt: Date; endAt: Date }> {
    return slots.filter(slot => {
      // Check specific artist conflicts
      const artistConflicts = conflictMap.get(slot.artistId) || [];
      const hasArtistConflict = artistConflicts.some(conflict => 
        slot.startAt < conflict.end && conflict.start < slot.endAt
      );
      
      if (hasArtistConflict) return false;

      // Check anonymous capacity conflicts (for auto-assign)
      if (includeAnonymousCapacity) {
        const anonConflicts = conflictMap.get('ANONYMOUS_CAPACITY') || [];
        const hasAnonConflict = anonConflicts.some(conflict =>
          slot.startAt < conflict.end && conflict.start < slot.endAt
        );
        if (hasAnonConflict) return false;
      }

      return true;
    });
  }

  return {
    hasOverlap,
    buildArtistConflictMap,
    hasSlotConflict,
    filterSlotsByConflicts,
    getBlockingStatuses: () => ({
      bookingStatuses: ['CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'],
      assignmentStatuses: ['PENDING', 'CONFIRMED'],
      holdStatuses: ['HOLD_ACTIVE'],
    }),
  };
}

export type { TimeSlot } from './slot-generator.js';