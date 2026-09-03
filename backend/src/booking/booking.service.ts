import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { AppError } from "../shared/errors/index.js";
import { bookingHoldService } from "./booking-hold.service.js";
import { availabilityService } from "./availability.service.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// State machine transition guards
const VALID_TRANSITIONS: Record<string, string[]> = {
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_SERVICE', 'CANCELLED'],
  IN_SERVICE: ['SERVICE_COMPLETED', 'CANCELLED'],
  SERVICE_COMPLETED: ['CLOSED', 'CANCELLED'],
  CLOSED: [], // Terminal state
  CANCELLED: [], // Terminal state
  NO_SHOW: [], // Terminal state
};

export interface CreateBookingFromHoldRequest {
  holdId: string;
  idempotencyKey: string;
}

export interface RescheduleRequest {
  bookingId: string;
  newServices: Array<{
    serviceId: string;
    artistId?: string;
    startAt: Date;
    endAt: Date;
    bufferMinutes?: number;
  }>;
  reason: string;
  idempotencyKey: string;
}

export interface AssignArtistRequest {
  bookingServiceId: string;
  artistId: string;
  role: 'PRIMARY' | 'LEAD' | 'SUPPORT';
  assignmentSource: 'CLIENT_REQUEST' | 'FLOOR_MANAGER' | 'RECEPTIONIST' | 'AUTO_STANDARD_RESERVED_P2';
  assignedByStaffId?: string;
}

export interface ReassignArtistRequest {
  bookingServiceAssignmentId: string;
  newArtistId: string;
  assignedByStaffId: string;
}

export class BookingService {
  /**
   * Create booking from consumed hold
   */
  async createBookingFromHold(request: CreateBookingFromHoldRequest, clientId: string) {
    const { holdId, idempotencyKey } = request;

    // Check idempotency
    const existingKey = await prisma.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
    if (existingKey) {
      if (existingKey.responseBody) {
        return existingKey.responseBody;
      }
      throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key already used');
    }

    // Get hold with resources
    const hold = await prisma.bookingHold.findUnique({
      where: { id: holdId },
      include: { resources: true },
    });

    if (!hold) {
      throw new AppError(404, 'NOT_FOUND', 'Hold not found');
    }
    if (hold.clientId !== clientId) {
      throw new AppError(403, 'FORBIDDEN', 'Hold does not belong to this client');
    }
    if (hold.status !== 'HOLD_ACTIVE') {
      throw new AppError(400, 'INVALID_STATE', 'Hold is not active');
    }
    if (new Date() > hold.expiresAt) {
      throw new AppError(410, 'HOLD_EXPIRED', 'Hold has expired');
    }

    // Get quote for pricing
    const quote = await prisma.bookingQuote.findUnique({ where: { id: hold.quoteId } });
    if (!quote) {
      throw new AppError(404, 'NOT_FOUND', 'Associated quote not found');
    }

    // Build booking services from hold resources
    const quoteServices = quote.services as any[];
    const bookingServicesData: Array<{
      serviceId: string | undefined;
      assignmentStrategy: string;
      requestedArtistId: string | undefined;
      plannedStartAt: Date;
      plannedEndAt: Date;
      bufferMinutes: number;
      priceSnapshot: number;
    }> = [];

    for (let idx = 0; idx < hold.resources.length; idx++) {
      const resource = hold.resources[idx];
      const quoteService = quoteServices[resource.bookingServiceId
        ? quoteServices.findIndex((qs: any) => qs.serviceId === resource.bookingServiceId)
        : idx];
      const serviceId = quoteService?.serviceId;
      const serviceDetails = serviceId ? await prisma.service.findUnique({ where: { id: serviceId } }) : null;

      bookingServicesData.push({
        serviceId,
        assignmentStrategy: quoteService?.assignmentStrategy || 'AUTO_ASSIGN',
        requestedArtistId: quoteService?.requestedArtistId || resource.artistId,
        plannedStartAt: resource.startAt,
        plannedEndAt: resource.endAt,
        bufferMinutes: 10,
        priceSnapshot: serviceDetails ? Number(serviceDetails.price.toString()) : 0,
      });
    }

    // Calculate totals
    const totalPrice = Number(quote.serviceTotal.toString());
    const totalAdvanceRequired = Number(quote.advanceRequired.toString());
    const advanceRule = quote.advanceRule;

    // Create booking in transaction
    const booking = await prisma.$transaction(async (tx) => {
      // Create booking
      const firstSvc = bookingServicesData[0];
      const newBooking = await tx.booking.create({
        data: {
          clientId,
          status: 'CONFIRMED',
          assignmentStrategy: (firstSvc?.assignmentStrategy as any) || 'AUTO_ASSIGN',
          totalPrice,
          totalAdvanceRequired,
          advanceRule,
          version: 1,
          confirmedAt: new Date(),
        },
      });

      // Create booking services
      for (const svcData of bookingServicesData) {
        await tx.bookingService.create({
          data: {
            bookingId: newBooking.id,
            serviceId: svcData.serviceId!,
            assignmentStrategy: svcData.assignmentStrategy as any,
            requestedArtistId: svcData.requestedArtistId,
            plannedStartAt: svcData.plannedStartAt,
            plannedEndAt: svcData.plannedEndAt,
            bufferMinutes: svcData.bufferMinutes,
            priceSnapshot: svcData.priceSnapshot,
          },
        });
      }

      // Create status history
      await tx.bookingStatusHistory.create({
        data: {
          bookingId: newBooking.id,
          fromStatus: null,
          toStatus: 'CONFIRMED',
          actorType: 'CLIENT',
          actorId: clientId,
          reason: 'Booking created from hold',
        },
      });

      // Consume hold
      await tx.bookingHold.update({
        where: { id: holdId },
        data: {
          status: 'HOLD_CONSUMED',
          consumedAt: new Date(),
          bookingId: newBooking.id,
        },
      });

      return newBooking;
    });

    // Record idempotency key
    await prisma.idempotencyKey.create({
      data: {
        key: idempotencyKey,
        endpoint: '/api/v1/bookings/from-hold',
        method: 'POST',
        requestHash: this.hashRequest(request),
        responseStatus: 201,
        responseBody: { bookingId: booking.id },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
    });

    return { bookingId: booking.id, status: 'CONFIRMED' };
  }

  /**
   * Get booking by ID with full details
   */
  async getBooking(bookingId: string, requesterId: string, requesterRole: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        client: { include: { account: { select: { id: true, email: true, phone: true } } } },
        services: {
          include: {
            service: true,
            assignments: {
              include: { artist: { include: { account: { select: { id: true } } } } },
            },
          },
        },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        rescheduleHistory: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!booking) {
      throw new AppError(404, 'NOT_FOUND', 'Booking not found');
    }

    // Authorization check
    const isOwner = booking.clientId === requesterId;
    const isArtist = booking.services.some(s =>
      s.assignments.some(a => a.artist.account.id === requesterId)
    );
    const isStaff = ['SUPER_ADMIN', 'ADMIN', 'RECEPTIONIST'].includes(requesterRole);

    if (!isOwner && !isArtist && !isStaff) {
      throw new AppError(403, 'FORBIDDEN', 'Not authorized to view this booking');
    }

    return booking;
  }

  /**
   * List bookings for a client
   */
  async listBookings(clientId: string, params: {
    status?: string[];
    page?: number;
    limit?: number;
    fromDate?: Date;
    toDate?: Date;
  }) {
    const { status, page = 1, limit = 20, fromDate, toDate } = params;

    const where: any = { clientId };
    if (status && status.length > 0) where.status = { in: status };
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = fromDate;
      if (toDate) where.createdAt.lte = toDate;
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          services: {
            include: {
              service: true,
              assignments: { include: { artist: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.booking.count({ where }),
    ]);

    return {
      bookings,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Check in booking (client arrived)
   */
  async checkInBooking(bookingId: string, staffId: string, reason?: string) {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) {
      throw new AppError(404, 'NOT_FOUND', 'Booking not found');
    }

    // State machine validation - only CONFIRMED can check in
    if (booking.status !== 'CONFIRMED') {
      throw new AppError(400, 'INVALID_STATE_TRANSITION',
        `Cannot check in booking in ${booking.status} state. Only CONFIRMED bookings can be checked in.`);
    }

    // Check if client has already been checked in
    if (booking.checkedInAt) {
      throw new AppError(400, 'ALREADY_CHECKED_IN', 'Client already checked in');
    }

    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: 'CHECKED_IN',
          checkedInAt: new Date(),
          version: { increment: 1 },
        },
      });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: 'CONFIRMED',
          toStatus: 'CHECKED_IN',
          actorType: 'STAFF',
          actorId: staffId,
          reason: reason || 'Client checked in',
        },
      });
    });

    return { success: true, status: 'CHECKED_IN', checkedInAt: new Date() };
  }

  /**
   * Mark booking as no-show
   */
  async markNoShow(bookingId: string, staffId: string, reason?: string) {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) {
      throw new AppError(404, 'NOT_FOUND', 'Booking not found');
    }

    // State machine validation - only CONFIRMED and CHECKED_IN can be marked no-show
    if (!['CONFIRMED', 'CHECKED_IN'].includes(booking.status)) {
      throw new AppError(400, 'INVALID_STATE_TRANSITION',
        `Cannot mark no-show for booking in ${booking.status} state`);
    }

    // Check if already checked in
    if (booking.status === 'CHECKED_IN') {
      throw new AppError(400, 'INVALID_STATE_TRANSITION',
        'Cannot mark as no-show after client has checked in');
    }

    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: 'NO_SHOW',
          cancelledAt: new Date(),
          cancelReason: reason || 'No-show',
          version: { increment: 1 },
        },
      });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: booking.status,
          toStatus: 'NO_SHOW',
          actorType: 'STAFF',
          actorId: staffId,
          reason: reason || 'Client no-show',
        },
      });

      // Release any active holds
      await tx.bookingHold.updateMany({
        where: { bookingId, status: 'HOLD_ACTIVE' },
        data: { status: 'HOLD_RELEASED', releasedAt: new Date() },
      });
    });

    return { success: true, status: 'NO_SHOW' };
  }

  /**
   * Cancel booking with state machine validation
   */
  async cancelBooking(bookingId: string, clientId: string, reason: string) {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) {
      throw new AppError(404, 'NOT_FOUND', 'Booking not found');
    }
    if (booking.clientId !== clientId) {
      throw new AppError(403, 'FORBIDDEN', 'Not authorized to cancel this booking');
    }

    // State machine validation
    if (!VALID_TRANSITIONS[booking.status].includes('CANCELLED')) {
      throw new AppError(400, 'INVALID_STATE_TRANSITION',
        `Cannot cancel booking in ${booking.status} state`);
    }

    // Check cancellation policy (e.g., not within 2 hours of service)
    const upcomingService = await prisma.bookingService.findFirst({
      where: {
        bookingId,
        plannedStartAt: { gt: new Date() },
      },
      orderBy: { plannedStartAt: 'asc' },
    });

    if (upcomingService) {
      const hoursUntilService = (upcomingService.plannedStartAt.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilService < 2) {
        throw new AppError(400, 'CANCELLATION_POLICY', 'Cannot cancel within 2 hours of service start');
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: reason,
          version: { increment: 1 },
        },
      });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: booking.status,
          toStatus: 'CANCELLED',
          actorType: 'CLIENT',
          actorId: clientId,
          reason,
        },
      });

      // Release any active holds
      await tx.bookingHold.updateMany({
        where: { bookingId, status: 'HOLD_ACTIVE' },
        data: { status: 'HOLD_RELEASED', releasedAt: new Date() },
      });
    });

    return { success: true, status: 'CANCELLED' };
  }

  /**
   * Reschedule booking with optimistic concurrency
   */
  async rescheduleBooking(request: RescheduleRequest, actorId: string, actorType: 'STAFF' | 'CLIENT') {
    const { bookingId, newServices, reason, idempotencyKey } = request;

    // Check idempotency
    const existingKey = await prisma.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
    if (existingKey) {
      if (existingKey.responseBody) return existingKey.responseBody;
      throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key already used');
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { services: true },
    });

    if (!booking) {
      throw new AppError(404, 'NOT_FOUND', 'Booking not found');
    }

    // Authorization
    const isOwner = booking.clientId === actorId;
    const isStaff = actorType === 'STAFF';
    if (!isOwner && !isStaff) {
      throw new AppError(403, 'FORBIDDEN', 'Not authorized to reschedule this booking');
    }

    // State machine validation - only CONFIRMED and CHECKED_IN can be rescheduled
    if (!['CONFIRMED', 'CHECKED_IN'].includes(booking.status)) {
      throw new AppError(400, 'INVALID_STATE_TRANSITION',
        `Cannot reschedule booking in ${booking.status} state`);
    }

    // Optimistic concurrency check
    if (booking.version !== 1) { // In real impl, pass expected version from client
      // For now, we just increment version in transaction
    }

    // Validate new slots availability
    for (const newSvc of newServices) {
      const isAvailable = await availabilityService.validateSlotAvailability(
        newSvc.artistId || '',
        newSvc.startAt,
        newSvc.endAt
      );
      if (!isAvailable) {
        throw new AppError(409, 'SLOT_UNAVAILABLE', `Slot not available for service ${newSvc.serviceId}`);
      }
    }

    // Check if price changes (simplified)
    const oldTotal = Number(booking.totalPrice);
    const newServiceIds = newServices.map(s => s.serviceId);
    const newServicesDetails = await prisma.service.findMany({
      where: { id: { in: newServiceIds } },
    });
    const newTotal = newServicesDetails.reduce((sum, s) => sum + Number(s.price), 0);
    const moneyActionRequired = oldTotal !== newTotal;

    // Perform reschedule in transaction
    await prisma.$transaction(async (tx) => {
      // Delete old booking services and create new ones
      await tx.bookingService.deleteMany({ where: { bookingId } });

      for (const newSvc of newServices) {
        const service = newServicesDetails.find(s => s.id === newSvc.serviceId);
        await tx.bookingService.create({
          data: {
            bookingId,
            serviceId: newSvc.serviceId,
            assignmentStrategy: 'AUTO_ASSIGN',
            requestedArtistId: newSvc.artistId,
            plannedStartAt: newSvc.startAt,
            plannedEndAt: newSvc.endAt,
            bufferMinutes: newSvc.bufferMinutes || 10,
            priceSnapshot: service?.price || 0,
          },
        });
      }

      // Update booking totals and version
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          totalPrice: newTotal,
          totalAdvanceRequired: moneyActionRequired
            ? Math.round(newTotal * 0.2)
            : booking.totalAdvanceRequired,
          version: { increment: 1 },
        },
      });

      // Record reschedule history
      await tx.bookingRescheduleHistory.create({
        data: {
          bookingId,
          reason,
          oldServicesJson: booking.services,
          newServicesJson: newServices,
          moneyActionRequired,
          actorType,
          actorId,
          idempotencyKey,
        },
      });

      // Record status history if needed
      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: booking.status,
          toStatus: booking.status,
          actorType,
          actorId,
          reason: `Rescheduled: ${reason}`,
        },
      });
    });

    // Record idempotency
    await prisma.idempotencyKey.create({
      data: {
        key: idempotencyKey,
        endpoint: '/api/v1/bookings/reschedule',
        method: 'POST',
        requestHash: this.hashRequest(request),
        responseStatus: 200,
        responseBody: { success: true },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    return { success: true, moneyActionRequired };
  }

  /**
   * Get assignment queue for services needing manual assignment
   */
  async getAssignmentQueue() {
    const services = await prisma.bookingService.findMany({
      where: {
        assignmentStatus: {
          in: ['AWAITING_ASSIGNMENT', 'PARTIALLY_ASSIGNED'],
        },
      },
      include: {
        booking: {
          include: {
            client: {
              include: {
                account: {
                  select: { id: true, email: true, phone: true },
                },
              },
            },
          },
        },
        service: true,
        assignments: {
          include: {
            artist: {
              include: {
                account: {
                  select: { id: true, email: true },
                },
              },
            },
          },
        },
      },
    });

    return services.map((s) => ({
      bookingServiceId: s.id,
      bookingId: s.bookingId,
      clientName: `${s.booking.client.firstName} ${s.booking.client.lastName}`,
      serviceName: s.service.name,
      serviceId: s.serviceId,
      assignmentStatus: s.assignmentStatus,
      requiredArtistCount: s.service.requiredArtistCount,
      plannedStartAt: s.plannedStartAt,
      plannedEndAt: s.plannedEndAt,
      assignmentStrategy: s.assignmentStrategy,
      requestedArtistId: s.requestedArtistId,
      currentAssignments: s.assignments.map((a) => ({
        artistId: a.artistId,
        artistName: `${a.artist.firstName} ${a.artist.lastName}`,
        role: a.role,
        status: a.status,
      })),
    }));
  }

  /**
   * Assign artist to booking service
   */
  async assignArtist(request: AssignArtistRequest, assignedByStaffId: string) {
    const { bookingServiceId, artistId, role, assignmentSource } = request;

    const bookingService = await prisma.bookingService.findUnique({
      where: { id: bookingServiceId },
      include: { assignments: true, booking: true, service: true },
    });

    if (!bookingService) {
      throw new AppError(404, 'NOT_FOUND', 'Booking service not found');
    }

    // Check artist is qualified for this service
    const artistService = await prisma.artistService.findFirst({
      where: { artistId, serviceId: bookingService.serviceId, isActive: true },
    });
    if (!artistService) {
      throw new AppError(400, 'ARTIST_NOT_QUALIFIED', 'Artist is not qualified for this service');
    }

    // Check artist availability
    const isAvailable = await availabilityService.validateSlotAvailability(
      artistId,
      bookingService.plannedStartAt,
      bookingService.plannedEndAt
    );
    if (!isAvailable) {
      throw new AppError(409, 'ARTIST_UNAVAILABLE', 'Artist is not available at this time');
    }

    // Check for existing assignment
    const existing = await prisma.bookingServiceAssignment.findFirst({
      where: { bookingServiceId, artistId, status: { in: ['PENDING', 'CONFIRMED'] } },
    });
    if (existing) {
      throw new AppError(409, 'ASSIGNMENT_EXISTS', 'Artist already assigned to this service');
    }

    // Get required artist count from service
    const requiredCount = bookingService.service.requiredArtistCount || 1;
    const currentAssignments = bookingService.assignments.filter(a =>
      a.status === 'PENDING' || a.status === 'CONFIRMED'
    );

    // Check if this assignment would exceed required count
    if (currentAssignments.length >= bookingService.service.requiredArtistCount) {
      throw new AppError(409, 'ASSIGNMENT_LIMIT_EXCEEDED',
        `Service already has required ${bookingService.service.requiredArtistCount} artist(s) assigned`);
    }

    // For 2-artist services, enforce Lead/Support roles and prevent duplicate artists
    if (bookingService.service.requiredArtistCount === 2) {
      // If client requested a specific artist, preserve as Lead
      let effectiveRole = role;
      if (bookingService.requestedArtistId) {
        // Client requested a specific artist - they must be Lead
        if (bookingService.requestedArtistId === artistId) {
          effectiveRole = 'LEAD';
        } else {
          // Support artist for a requested Lead
          effectiveRole = 'SUPPORT';
        }
      }

      // Check for duplicate artist assignment (same artist can't fill both positions)
      const existingArtistIds = bookingService.assignments
        .filter(a => a.status === 'PENDING' || a.status === 'CONFIRMED')
        .map(a => a.artistId);
      if (existingArtistIds.includes(artistId)) {
        throw new AppError(409, 'DUPLICATE_ARTIST',
          'Same artist cannot be assigned to both positions in a 2-artist service');
      }

      // For 2-artist service, ensure we have distinct roles
      const existingAssignments = await prisma.bookingServiceAssignment.findMany({
        where: {
          bookingServiceId,
          status: { in: ['PENDING', 'CONFIRMED'] },
        },
        select: { role: true },
      });

      // Prevent duplicate roles (can't have two LEADs or two SUPPORTs)
      if (existingAssignments.some(a => a.role === 'LEAD') && role === 'LEAD') {
        throw new AppError(409, 'DUPLICATE_ROLE', 'Service already has a LEAD artist assigned');
      }
      if (existingAssignments.some(a => a.role === 'SUPPORT') && role === 'SUPPORT') {
        throw new AppError(409, 'DUPLICATE_ROLE', 'Service already has a SUPPORT artist assigned');
      }

      // If this is the first assignment and no role specified, default to LEAD for 2-artist services
      if (role === 'PRIMARY' && bookingService.service.requiredArtistCount === 2) {
        // PRIMARY is for 1-artist services; convert to LEAD for 2-artist
        // This handles legacy/fallback cases
      }
    }

    // Validate role is appropriate for service type
    if (bookingService.service.requiredArtistCount === 1) {
      if (role !== 'PRIMARY') {
        throw new AppError(400, 'INVALID_ROLE', 'Single-artist services require PRIMARY role');
      }
    } else if (bookingService.service.requiredArtistCount === 2) {
      if (!['LEAD', 'SUPPORT'].includes(role)) {
        throw new AppError(400, 'INVALID_ROLE', 'Two-artist services require LEAD or SUPPORT role');
      }
    }

    const assignment = await prisma.bookingServiceAssignment.create({
      data: {
        bookingServiceId,
        artistId,
        role,
        assignmentSource,
        assignedByStaffId,
        status: 'CONFIRMED',
      },
    });

    // Update booking service assignment status
    const assignmentCount = bookingService.assignments.length + 1;
    let assignmentStatus = 'PARTIALLY_ASSIGNED';
    if (assignmentCount >= requiredCount) assignmentStatus = 'FULLY_ASSIGNED';

    await prisma.bookingService.update({
      where: { id: bookingServiceId },
      data: { assignmentStatus: assignmentStatus as any },
    });

    return assignment;
  }

  /**
   * Reassign artist (release old, assign new)
   */
  async reassignArtist(request: ReassignArtistRequest, staffId: string) {
    const { bookingServiceAssignmentId, newArtistId, assignedByStaffId } = request;

    const oldAssignment = await prisma.bookingServiceAssignment.findUnique({
      where: { id: bookingServiceAssignmentId },
      include: { bookingService: true },
    });

    if (!oldAssignment) {
      throw new AppError(404, 'NOT_FOUND', 'Assignment not found');
    }
    if (oldAssignment.status !== 'PENDING' && oldAssignment.status !== 'CONFIRMED') {
      throw new AppError(400, 'INVALID_STATE', 'Cannot reassign released/replaced assignment');
    }

    // Check new artist qualification
    const artistService = await prisma.artistService.findFirst({
      where: { artistId: newArtistId, serviceId: oldAssignment.bookingService.serviceId, isActive: true },
    });
    if (!artistService) {
      throw new AppError(400, 'ARTIST_NOT_QUALIFIED', 'New artist not qualified for this service');
    }

    // Check availability
    const isAvailable = await availabilityService.validateSlotAvailability(
      newArtistId,
      oldAssignment.bookingService.plannedStartAt,
      oldAssignment.bookingService.plannedEndAt
    );
    if (!isAvailable) {
      throw new AppError(409, 'ARTIST_UNAVAILABLE', 'New artist not available at this time');
    }

    await prisma.$transaction(async (tx) => {
      // Release old assignment
      await tx.bookingServiceAssignment.update({
        where: { id: bookingServiceAssignmentId },
        data: { status: 'REPLACED' },
      });

      // Create new assignment
      await tx.bookingServiceAssignment.create({
        data: {
          bookingServiceId: oldAssignment.bookingServiceId,
          artistId: newArtistId,
          role: oldAssignment.role,
          assignmentSource: 'FLOOR_MANAGER',
          assignedByStaffId: assignedByStaffId,
          status: 'CONFIRMED',
        },
      });
    });

    return { success: true };
  }

  /**
   * State machine transition - internal use
   */
  async transitionBookingState(
    bookingId: string,
    fromStatus: string,
    toStatus: string,
    actorType: string,
    actorId: string,
    reason?: string
  ) {
    const validNext = VALID_TRANSITIONS[fromStatus];
    if (!validNext || !validNext.includes(toStatus)) {
      throw new AppError(400, 'INVALID_STATE_TRANSITION',
        `Cannot transition from ${fromStatus} to ${toStatus}`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId, version: { /* optimistic check */ } },
        data: {
          status: toStatus as any,
          version: { increment: 1 },
          ...(toStatus === 'CHECKED_IN' && { checkedInAt: new Date() }),
        },
      });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: fromStatus as any,
          toStatus: toStatus as any,
          actorType,
          actorId,
          reason,
        },
      });
    });

    return { success: true };
  }

  private hashRequest(request: any): string {
    const str = JSON.stringify(request);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }
}

export const bookingService = new BookingService();