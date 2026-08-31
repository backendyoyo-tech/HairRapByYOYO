/**
 * Availability Service - D7.7
 * Authoritative POST /availability/search implementation per YOYO Phase 1 API Contract v1.1
 */

import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { AppError } from "../shared/errors/index.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

export interface AvailabilitySearchRequest {
  clientId: string;
  requestedStartDate: Date;
  services: Array<{
    serviceId: string;
    requestedArtistId?: string;
    preferredStartAt?: Date;
  }>;
  groupContext?: {
    participantCount: number;
  };
}

export interface AvailabilitySlot {
  artistId: string;
  artistName: string;
  artistDisplayName: string;
  artistTier: string;
  startAt: Date;
  endAt: Date;
  available: boolean;
  isSpecificArtist: boolean;
  serviceId: string;
}

export interface AvailabilitySearchResult {
  serviceId: string;
  slots: AvailabilitySlot[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class AvailabilityService {
  private readonly ARTIST_BUFFER_MINUTES = 10;
  private readonly SLOT_INTERVAL_MINUTES = 15;
  private readonly BOOKING_HORIZON_DAYS = 60;
  private readonly SAME_DAY_LEAD_TIME_MINUTES = 30;

  /**
   * Core availability search - POST /availability/search
   * Computes authoritative joint feasibility without choosing a named Auto Assign artist
   */
  async searchAvailability(request: AvailabilitySearchRequest): Promise<AvailabilitySearchResult[]> {
    const { clientId, requestedStartDate, services, groupContext } = request;

    // Validate group size
    const totalParticipants = (groupContext?.participantCount || 1);
    if (totalParticipants > 5) {
      throw new AppError(422, 'GROUP_SIZE_EXCEEDED', 'Maximum 5 people total including organizer');
    }

    // Validate requested date is within 60-day horizon
    const now = new Date();
    const horizonEnd = new Date(now);
    horizonEnd.setDate(horizonEnd.getDate() + this.BOOKING_HORIZON_DAYS);
    
    const dayStart = new Date(requestedStartDate);
    dayStart.setHours(0, 0, 0, 0);
    
    if (dayStart > horizonEnd) {
      throw new AppError(422, 'BOOKING_HORIZON_EXCEEDED', 'Booking is available only up to 60 days in advance');
    }

    // Validate same-day lead time (30 minutes)
    if (this.isSameDay(dayStart, now)) {
      const minutesUntilStart = this.getMinutesUntil(dayStart, now);
      if (minutesUntilStart < this.SAME_DAY_LEAD_TIME_MINUTES) {
        throw new AppError(422, 'SAME_DAY_LEAD_TIME', 'Choose a time at least 30 minutes from now');
      }
    }

    // Validate all services exist and are active
    const serviceIds = services.map(s => s.serviceId);
    const serviceDetails = await prisma.service.findMany({
      where: { id: { in: serviceIds }, isActive: true },
      select: {
        id: true,
        name: true,
        durationMinutes: true,
        requiredArtistCount: true,
        creativeDirectorEligible: true,
      },
    });

    if (serviceDetails.length !== serviceIds.length) {
      throw new AppError(422, 'SERVICE_INACTIVE', 'One or more services not found or inactive');
    }

    // Validate slot grid (15-minute intervals) for any preferredStartAt
    for (const service of services) {
      if (service.preferredStartAt && !this.isOnSlotGrid(service.preferredStartAt)) {
        throw new AppError(422, 'SLOT_GRID_INVALID', 'Start time must be on 15-minute grid (:00, :15, :30, :45)');
      }
    }

    // Validate specific artist eligibility for each service
    for (const service of services) {
      if (service.requestedArtistId) {
        await this.validateSpecificArtistEligibility(service.requestedArtistId, service.serviceId, requestedStartDate);
      }
    }

    // Get day of week
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

    const artists = await prisma.artistProfile.findMany({
      where: artistQuery,
      include: {
        account: { select: { id: true } },
        workSchedules: {
          where: { dayOfWeek, isActive: true },
        },
        scheduleExceptions: {
          where: { exceptionDate: { gte: dayStart, lt: new Date(dayStart.getTime() + 24 * 60 * 60 * 1000) } },
        },
      },
    });

    // Get existing holds that overlap with the date
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const holds = await prisma.bookingHoldResource.findMany({
      where: {
        startAt: { lt: dayEnd },
        endAt: { gt: dayStart },
        hold: { status: 'HOLD_ACTIVE', expiresAt: { gt: now } },
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
        serviceId: true,
        artistId: true,
        requestedArtistId: true,
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

    // Add booked slots with assignments
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

    // Generate available slots per service
    const results: AvailabilitySearchResult[] = [];

    for (const service of services) {
      const serviceDetail = serviceDetails.find(s => s.id === service.serviceId)!;
      const serviceDuration = serviceDetail.durationMinutes;
      const totalDurationWithBuffer = serviceDuration + this.ARTIST_BUFFER_MINUTES;

      const allSlots: AvailabilitySlot[] = [];

      for (const artist of artists) {
        const artistId = artist.id;
        
        // Check if this specific artist was requested for this service
        const isSpecificArtistRequest = service.requestedArtistId === artistId;
        
        // If specific artist requested but this isn't the requested artist, skip
        if (service.requestedArtistId && !isSpecificArtistRequest) {
          continue;
        }

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

          let scheduleStart = new Date(dayStart);
          scheduleStart.setHours(schedule.startTime.getHours(), schedule.startTime.getMinutes(), 0, 0);
          let scheduleEnd = new Date(dayStart);
          scheduleEnd.setHours(schedule.endTime.getHours(), schedule.endTime.getMinutes(), 0, 0);

          // Check for partial exception overriding this schedule
          const blockingException = exceptions.find(e => 
            e.startTime !== null && e.endTime !== null && 
            !e.isAvailable &&
            this.timeOverlaps(scheduleStart, scheduleEnd, 
              new Date(dayStart.getTime() + e.startTime!.getHours() * 60 * 60 * 1000 + e.startTime!.getMinutes() * 60 * 1000),
              new Date(dayStart.getTime() + e.endTime!.getHours() * 60 * 60 * 1000 + e.endTime!.getMinutes() * 60 * 1000))
          );
          if (blockingException) {
            // Day off exception blocks this entire schedule window
            continue;
          }

          // Generate slots at 15-minute intervals
          const busyIntervals = artistBusyIntervals.get(artistId) || [];
          
          let slotStart = new Date(scheduleStart);
          while (slotStart < scheduleEnd) {
            const slotEnd = new Date(slotStart.getTime() + totalDurationWithBuffer * 60000);

            // Service execution must finish by schedule end (buffer can extend beyond)
            if (slotStart.getTime() + serviceDuration * 60000 > scheduleEnd.getTime()) {
              break;
            }

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
                endAt: new Date(slotStart.getTime() + serviceDuration * 60000), // Client-facing end time (without buffer)
                available: true,
                isSpecificArtist: isSpecificArtistRequest,
                serviceId: service.serviceId,
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
            const slotEnd = new Date(slotStart.getTime() + totalDurationWithBuffer * 60000);
            if (slotStart.getTime() + serviceDuration * 60000 > excEnd.getTime()) break;

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
                endAt: new Date(slotStart.getTime() + serviceDuration * 60000),
                available: true,
                isSpecificArtist: isSpecificArtistRequest,
                serviceId: service.serviceId,
              });
            }
            slotStart = new Date(slotStart.getTime() + this.SLOT_INTERVAL_MINUTES * 60000);
          }
        }
      }

      // Sort slots: specific artist first, then by tier priority, then by time
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

      // Pagination (page=1, limit=50 default per contract)
      const page = 1;
      const limit = 50;
      const total = allSlots.length;
      const totalPages = Math.ceil(total / limit);
      const paginatedSlots = allSlots.slice((page - 1) * limit, page * limit);

      results.push({
        serviceId: service.serviceId,
        slots: paginatedSlots,
        pagination: { page, limit, total, totalPages },
      });
    }

    return results;
  }

  /**
   * Validates specific artist eligibility for a service on a date
   */
  private async validateSpecificArtistEligibility(
    artistId: string,
    serviceId: string,
    requestedStartDate: Date
  ): Promise<void> {
    const dayStart = new Date(requestedStartDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    // Check artist profile is active and mapped to service
    const artist = await prisma.artistProfile.findFirst({
      where: {
        id: artistId,
        isAvailable: true,
        artistServices: {
          some: { serviceId, isActive: true },
        },
      },
    });

    if (!artist) {
      throw new AppError(422, 'ARTIST_NOT_ELIGIBLE', 'Selected artist cannot be booked for this service');
    }

    // Check artist has shift on this day
    const dayOfWeek = dayStart.getDay();
    const schedule = await prisma.artistWorkSchedule.findFirst({
      where: {
        artistId,
        dayOfWeek,
        isActive: true,
      },
    });

    if (!schedule) {
      // Check for exception-based availability
      const exception = await prisma.artistScheduleException.findFirst({
        where: {
          artistId,
          exceptionDate: { gte: dayStart, lt: dayEnd },
          isAvailable: true,
        },
      });
      if (!exception) {
        throw new AppError(422, 'ARTIST_SCHEDULE_CONFLICT', 'Artist is not available at this time');
      }
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
              { startTime: { lte: dayEnd } },
              { endTime: { gte: dayStart } },
            ],
          },
        ],
      },
    });

    if (dayOff) {
      throw new AppError(422, 'ARTIST_SCHEDULE_CONFLICT', 'Artist is not available at this time');
    }
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
      hold: { status: 'HOLD_ACTIVE', expiresAt: { gt: new Date() } },
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

  private getArtistTier(artist: any): string {
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

  private isOnSlotGrid(date: Date): boolean {
    const minutes = date.getMinutes();
    return minutes % 15 === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0;
  }

  private isSameDay(date1: Date, date2: Date): boolean {
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
  }

  private getMinutesUntil(target: Date, from: Date): number {
    return (target.getTime() - from.getTime()) / (1000 * 60);
  }
}

export const availabilityService = new AvailabilityService();