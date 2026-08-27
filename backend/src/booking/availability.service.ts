import { PrismaClient } from "../shared/generated/prisma/index.js";
import { AppError } from "../shared/errors/app-error.js";

const prisma = new PrismaClient();

export interface AvailabilitySlot {
  artistId: string;
  artistName: string;
  artistDisplayName: string;
  artistTier: string;
  startAt: Date;
  endAt: Date;
  available: boolean;
  isSpecificArtist: boolean;
}

export interface AvailabilitySearchParams {
  serviceIds: string[];
  date: Date;
  requestedArtistId?: string;
  partySize?: number;
  page?: number;
  limit?: number;
}

export interface AvailabilitySearchResult {
  slots: AvailabilitySlot[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class AvailabilityService {
  private readonly HOLD_BUFFER_MINUTES = 10;
  private readonly SLOT_INTERVAL_MINUTES = 15;

  /**
   * Core availability search - finds available artist time slots for given services on a date
   */
  async searchAvailability(params: AvailabilitySearchParams): Promise<AvailabilitySearchResult> {
    const { serviceIds, date, requestedArtistId, partySize = 1, page = 1, limit = 50 } = params;

    // Validate services exist and get their details
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: {
        id: true,
        name: true,
        durationMinutes: true,
        requiredArtistCount: true,
        creativeDirectorEligible: true,
      },
    });

    if (services.length !== serviceIds.length) {
      throw new AppError(404, 'NOT_FOUND', 'One or more services not found');
    }

    // Calculate total duration needed
    const totalDuration = services.reduce((sum, s) => sum + s.durationMinutes + this.HOLD_BUFFER_MINUTES, 0);
    const maxArtistsNeeded = Math.max(...services.map(s => s.requiredArtistCount));

    // Get date boundaries
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    // Get day of week (0=Sunday)
    const dayOfWeek = dayStart.getDay();

    // Get all active artists who can perform these services
    const artistQuery: any = {
      isAvailable: true,
      artistServices: {
        some: {
          serviceId: { in: serviceIds },
          isActive: true,
        },
      },
      workSchedules: {
        some: {
          dayOfWeek,
          isActive: true,
        },
      },
    };

    if (requestedArtistId) {
      artistQuery.id = requestedArtistId;
    }

    const artists = await prisma.artistProfile.findMany({
      where: artistQuery,
      include: {
        account: { select: { id: true } },
        workSchedules: {
          where: { dayOfWeek, isActive: true },
        },
        scheduleExceptions: {
          where: { exceptionDate: { gte: dayStart, lt: dayEnd } },
        },
      },
    });

    // Get existing holds that overlap with the date
    const holds = await prisma.bookingHoldResource.findMany({
      where: {
        startAt: { lt: dayEnd },
        endAt: { gt: dayStart },
        hold: { status: 'HOLD_ACTIVE' },
      },
      include: { hold: true },
    });

    // Get existing bookings that overlap with the date
    const bookings = await prisma.bookingService.findMany({
      where: {
        plannedStartAt: { lt: dayEnd },
        plannedEndAt: { gt: dayStart },
        booking: { status: { in: ['CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'] } },
      },
      select: {
        id: true,
        artistId: true,
        plannedStartAt: true,
        plannedEndAt: true,
        bookingId: true,
      },
    });

    // Get assignments for booking services
    const bookingServiceIds = bookings.map(b => b.id);
    const assignments = await prisma.bookingServiceAssignment.findMany({
      where: {
        bookingServiceId: { in: bookingServiceIds },
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
      select: { bookingServiceId: true, artistId: true },
    });

    // Build artist -> busy intervals map
    const artistBusyIntervals = new Map<string, Array<{ start: Date; end: Date }>>();

    // Add holds
    for (const hold of holds) {
      if (hold.artistId) {
        const intervals = artistBusyIntervals.get(hold.artistId) || [];
        intervals.push({ start: hold.startAt, end: hold.endAt });
        artistBusyIntervals.set(hold.artistId, intervals);
      }
    }

    // Add booked slots
    for (const booking of bookings) {
      const assignedArtists = assignments
        .filter(a => a.bookingServiceId === booking.id)
        .map(a => a.artistId);

      // If no assignments yet, block the requested artist or all if AUTO_ASSIGN
      const targetArtists = assignedArtists.length > 0
        ? assignedArtists
        : (booking.requestedArtistId ? [booking.requestedArtistId] : artists.map(a => a.id));

      for (const artistId of targetArtists) {
        const intervals = artistBusyIntervals.get(artistId) || [];
        intervals.push({ start: booking.plannedStartAt, end: booking.plannedEndAt });
        artistBusyIntervals.set(artistId, intervals);
      }
    }

    // Generate available slots
    const allSlots: AvailabilitySlot[] = [];

    for (const artist of artists) {
      const artistId = artist.id;
      const artistName = `${artist.firstName} ${artist.lastName}`;
      const artistDisplayName = artist.displayName;
      const artistTier = this.getArtistTier(artist);

      // Get work schedule for this day
      const schedules = artist.workSchedules;
      const exceptions = artist.scheduleExceptions;

      for (const schedule of schedules) {
        // Check if full day off exception exists
        const fullDayOff = exceptions.find(e => e.startTime === null && e.endTime === null && !e.isAvailable);
        if (fullDayOff) continue;

        // Check for partial exception overriding this schedule
        const partialException = exceptions.find(e =>
          e.startTime !== null && e.endTime !== null &&
          ((e.isAvailable && this.timeOverlaps(schedule.startTime, schedule.endTime, e.startTime, e.endTime)) ||
           (!e.isAvailable && this.timeOverlaps(schedule.startTime, schedule.endTime, e.startTime, e.endTime)))
        );

        let scheduleStart = new Date(dayStart);
        scheduleStart.setHours(schedule.startTime.getHours(), schedule.startTime.getMinutes(), 0, 0);
        let scheduleEnd = new Date(dayStart);
        scheduleEnd.setHours(schedule.endTime.getHours(), schedule.endTime.getMinutes(), 0, 0);

        // Adjust for partial exception
        if (partialException && !partialException.isAvailable) {
          // Day off exception - skip this schedule
          continue;
        }

        // Generate slots at 15-minute intervals
        const busyIntervals = artistBusyIntervals.get(artistId) || [];

        let slotStart = new Date(scheduleStart);
        while (slotStart < scheduleEnd) {
          const slotEnd = new Date(slotStart.getTime() + totalDuration * 60000);

          if (slotEnd > scheduleEnd) break;

          // Check if slot conflicts with busy intervals
          const hasConflict = busyIntervals.some(interval =>
            this.timeOverlaps(slotStart, slotEnd, interval.start, interval.end)
          );

          if (!hasConflict) {
            allSlots.push({
              artistId,
              artistName,
              artistDisplayName,
              artistTier,
              startAt: new Date(slotStart),
              endAt: new Date(slotEnd),
              available: true,
              isSpecificArtist: !!requestedArtistId,
            });
          }

          slotStart = new Date(slotStart.getTime() + this.SLOT_INTERVAL_MINUTES * 60000);
        }
      }

      // Also check for extra availability from exceptions (isAvailable=true)
      for (const exception of exceptions) {
        if (!exception.isAvailable || !exception.startTime || !exception.endTime) continue;

        const excStart = new Date(dayStart);
        excStart.setHours(exception.startTime.getHours(), exception.startTime.getMinutes(), 0, 0);
        const excEnd = new Date(dayStart);
        excEnd.setHours(exception.endTime.getHours(), exception.endTime.getMinutes(), 0, 0);

        const busyIntervals = artistBusyIntervals.get(artistId) || [];
        let slotStart = new Date(excStart);
        while (slotStart < excEnd) {
          const slotEnd = new Date(slotStart.getTime() + totalDuration * 60000);
          if (slotEnd > excEnd) break;

          const hasConflict = busyIntervals.some(interval =>
            this.timeOverlaps(slotStart, slotEnd, interval.start, interval.end)
          );

          if (!hasConflict) {
            allSlots.push({
              artistId,
              artistName,
              artistDisplayName,
              artistTier,
              startAt: new Date(slotStart),
              endAt: new Date(slotEnd),
              available: true,
              isSpecificArtist: !!requestedArtistId,
            });
          }
          slotStart = new Date(slotStart.getTime() + this.SLOT_INTERVAL_MINUTES * 60000);
        }
      }
    }

    // Sort slots: specific artist first, then by tier priority (Creative Director > Top > Senior > Junior), then by time
    const tierPriority: Record<string, number> = {
      'Creative Director': 4,
      'Top Artist': 3,
      'Senior Artist': 2,
      'Junior Artist': 1,
    };

    allSlots.sort((a, b) => {
      if (a.isSpecificArtist !== b.isSpecificArtist) return b.isSpecificArtist ? 1 : -1;
      const tierDiff = (tierPriority[b.artistTier] || 0) - (tierPriority[a.artistTier] || 0);
      if (tierDiff !== 0) return tierDiff;
      return a.startAt.getTime() - b.startAt.getTime();
    });

    // Pagination
    const total = allSlots.length;
    const totalPages = Math.ceil(total / limit);
    const paginatedSlots = allSlots.slice((page - 1) * limit, page * limit);

    return {
      slots: paginatedSlots,
      pagination: { page, limit, total, totalPages },
    };
  }

  /**
   * Get artist tier from their profile (simplified - in real impl would use ArtistTier model)
   */
  private getArtistTier(artist: any): string {
    // This would ideally come from an ArtistTier relation
    // For now, derive from displayName or specialization
    if (artist.displayName.toLowerCase().includes('yoyo') || artist.displayName.toLowerCase().includes('creative')) {
      return 'Creative Director';
    }
    if (artist.specialization?.toLowerCase().includes('top') || artist.displayName.toLowerCase().includes('top')) {
      return 'Top Artist';
    }
    if (artist.specialization?.toLowerCase().includes('senior')) {
      return 'Senior Artist';
    }
    return 'Junior Artist';
  }

  private timeOverlaps(start1: Date, end1: Date, start2: Date, end2: Date): boolean {
    return start1 < end2 && start2 < end1;
  }

  /**
   * Check if a specific slot is still available (for hold/booking validation)
   */
  async validateSlotAvailability(
    artistId: string,
    startAt: Date,
    endAt: Date,
    excludeHoldId?: string
  ): Promise<boolean> {
    const dayStart = new Date(startAt);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    // Check holds
    const holdWhere: any = {
      artistId,
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      hold: { status: 'HOLD_ACTIVE' },
    };
    if (excludeHoldId) {
      holdWhere.hold.id = { not: excludeHoldId };
    }
    const holdConflict = await prisma.bookingHoldResource.findFirst({ where: holdWhere });
    if (holdConflict) return false;

    // Check bookings
    const bookingConflict = await prisma.bookingService.findFirst({
      where: {
        artistId,
        plannedStartAt: { lt: endAt },
        plannedEndAt: { gt: startAt },
        booking: { status: { in: ['CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'] } },
      },
    });
    if (bookingConflict) return false;

    // Check artist schedule
    const dayOfWeek = startAt.getDay();
    const schedule = await prisma.artistWorkSchedule.findFirst({
      where: {
        artistId,
        dayOfWeek,
        isActive: true,
        startTime: { lte: startAt },
        endTime: { gte: endAt },
      },
    });
    if (!schedule) {
      // Check for exception-based availability
      const exception = await prisma.artistScheduleException.findFirst({
        where: {
          artistId,
          exceptionDate: { gte: dayStart, lt: dayEnd },
          isAvailable: true,
          startTime: { lte: startAt },
          endTime: { gte: endAt },
        },
      });
      if (!exception) return false;
    }

    // Check for day-off exception
    const dayOff = await prisma.artistScheduleException.findFirst({
      where: {
        artistId,
        exceptionDate: { gte: dayStart, lt: dayEnd },
        isAvailable: false,
        OR: [
          { startTime: null, endTime: null }, // Full day off
          {
            AND: [
              { startTime: { lte: endAt } },
              { endTime: { gte: startAt } },
            ],
          },
        ],
      },
    });
    if (dayOff) return false;

    return true;
  }
}

export const availabilityService = new AvailabilityService();