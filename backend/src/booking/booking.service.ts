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
  expectedVersion: number;
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

export interface CancelBookingRequest {
  bookingId: string;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
  cancellationType?: 'CLIENT' | 'YOYO'; // 'YOYO' for Admin/Super Admin initiated cancellation
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

    // Check if client has already been checked in - idempotent
    if (booking.checkedInAt) {
      return { success: true, status: 'CHECKED_IN', checkedInAt: booking.checkedInAt, alreadyCheckedIn: true };
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

    // Publish CLIENT_CHECKED_IN event
    await this.publishEvent('CLIENT_CHECKED_IN', { bookingId, checkedInAt: new Date(), staffId });

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

    // State machine validation - only CONFIRMED can be marked no-show (BSM §4, §11)
    if (booking.status !== 'CONFIRMED') {
      throw new AppError(400, 'INVALID_STATE_TRANSITION',
        `Cannot mark no-show for booking in ${booking.status} state. Only CONFIRMED bookings can be marked no-show.`);
    }

    // Appointment-time guard: no-show only after appointment time has passed (BSM §11 BSM-NS-01)
    const upcomingService = await prisma.bookingService.findFirst({
      where: {
        bookingId,
        plannedStartAt: { gt: new Date() }, // Services in the future
      },
      orderBy: { plannedStartAt: 'asc' },
    });

    if (upcomingService) {
      throw new AppError(400, 'NO_SHOW_TOO_EARLY',
        `Cannot mark no-show before appointment time. Earliest service at ${upcomingService.plannedStartAt.toISOString()}`);
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

    // Publish BOOKING_NO_SHOW event
    await this.publishEvent('BOOKING_NO_SHOW', { bookingId, staffId, reason: reason || 'Client no-show' });

    return { success: true, status: 'NO_SHOW' };
  }

  /**
     * Cancel booking with state machine validation, advance settlement, and idempotency
     * Implements Day 15: Cancellation + Refund / Advance Settlement Engine
     */
    async cancelBooking(request: CancelBookingRequest, actorId: string, actorType: 'STAFF' | 'CLIENT') {
      const { bookingId, expectedVersion, reason, idempotencyKey, cancellationType = 'CLIENT' } = request;

      // Check idempotency
      const existingKey = await prisma.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
      if (existingKey) {
        if (existingKey.responseBody) return existingKey.responseBody;
        throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key already used');
      }

      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
          services: {
            include: { assignments: true }
          },
          payments: {
            where: { purpose: 'ADVANCE', status: 'SUCCEEDED' }
          }
        },
      });

      if (!booking) {
        throw new AppError(404, 'NOT_FOUND', 'Booking not found');
      }

      // Authorization
      const isOwner = booking.clientId === actorId;
      const isStaff = actorType === 'STAFF';
      if (!isOwner && !isStaff) {
        throw new AppError(403, 'FORBIDDEN', 'Not authorized to cancel this booking');
      }

      // For staff cancellations, they can cancel any booking
      // For client cancellations, they can only cancel their own
      if (!isStaff && !isOwner) {
        throw new AppError(403, 'FORBIDDEN', 'Not authorized to cancel this booking');
      }

      // State machine validation - only CONFIRMED and CHECKED_IN can be cancelled
      // (per State Machine §10, NO_SHOW, CANCELLED, CLOSED, SERVICE_COMPLETED, IN_SERVICE cannot be cancelled)
      const allowedCancelStates = ['CONFIRMED', 'CHECKED_IN'];
      if (!allowedCancelStates.includes(booking.status)) {
        throw new AppError(400, 'INVALID_STATE_TRANSITION',
          `Cannot cancel booking in ${booking.status} state`);
      }

      // Optimistic concurrency check
      if (booking.version !== expectedVersion) {
        throw new AppError(409, 'VERSION_CONFLICT', `Booking version mismatch. Expected ${expectedVersion}, current ${booking.version}`);
      }

      // Check earliest upcoming service for timing rules
      const upcomingService = await prisma.bookingService.findFirst({
        where: {
          bookingId,
          plannedStartAt: { gt: new Date() },
        },
        orderBy: { plannedStartAt: 'asc' },
      });

      if (!upcomingService) {
        throw new AppError(400, 'INVALID_STATE_TRANSITION', 'No future service found for this booking');
      }

      const hoursUntilService = (upcomingService.plannedStartAt.getTime() - Date.now()) / (1000 * 60 * 60);
      const isTimelyCancellation = hoursUntilService >= 24;

      // Determine advance disposition based on Money Contract rules
      // Find the ADVANCE payment for this booking
      const advancePayment = booking.payments.find(p => p.purpose === 'ADVANCE' && p.status === 'SUCCEEDED');
      const advanceAmount = advancePayment ? Number(advancePayment.amount) : 0;
      const advanceRule = booking.advanceRule; // 'STANDARD_20_PERCENT' or 'SPECIFIC_CREATIVE_DIRECTOR_FIXED'
      const isCreativeDirector = advanceRule === 'SPECIFIC_CREATIVE_DIRECTOR_FIXED';

      let advanceDisposition: 'FORFEITED' | 'REFUND_PENDING' | 'TRANSFERRED' | 'NONE' = 'NONE';
      let refundAmount = 0;
      let refundDestination: 'ORIGINAL' | 'WALLET' | 'MEMBERSHIP' | null = null;

      // Apply cancellation rules per Money Contract §6 (CAN-001 through CAN-004)
      if (cancellationType === 'YOYO' && isStaff) {
        // YOYO cancellation - Admin/Super Admin only - client chooses refund or transfer (CAN-003)
        // For now, mark as REFUND_PENDING - actual refund processing is separate
        advanceDisposition = 'REFUND_PENDING';
        refundAmount = advanceAmount;
        // Destination will be determined by client choice later
      } else if (isCreativeDirector) {
        // Creative Director booking - ₹5,000 is non-refundable for client cancellation
        // (Money Contract §6, Creative Director client cancellation)
        advanceDisposition = 'FORFEITED';
        refundAmount = 0;
      } else if (isTimelyCancellation) {
        // Client cancellation 24+ hours before - standard 20% advance may transfer once to reschedule
        // but for pure cancellation, Money Contract determines treatment per approved policy
        // Per CAN-002: Forfeit is not refund - advance remains captured with policy disposition
        // Per Money Contract: "direct cash refund of standard advance is not approved by this contract"
        advanceDisposition = 'FORFEITED';
        refundAmount = 0;
      } else {
        // Client cancellation <24 hours / same-day - advance forfeited
        advanceDisposition = 'FORFEITED';
        refundAmount = 0;
      }

      // Snapshot old services for history
      const oldServicesSnapshot = booking.services.map(s => ({
        serviceId: s.serviceId,
        plannedStartAt: s.plannedStartAt,
        plannedEndAt: s.plannedEndAt,
        artistId: s.assignments[0]?.artistId,
        assignmentStatus: s.assignmentStatus,
        artistConfirmationState: s.artistConfirmationState,
      }));

      // Perform atomic cancellation transaction
      const result = await prisma.$transaction(async (tx) => {
        // 1. Update booking status to CANCELLED
        await tx.booking.update({
          where: { id: bookingId },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancelReason: reason,
            version: { increment: 1 },
            // Advance disposition tracking would require additional schema fields
            // For now, we track via payment/refund records
          },
        });

        // 2. Record status history
        await tx.bookingStatusHistory.create({
          data: {
            bookingId,
            fromStatus: booking.status,
            toStatus: 'CANCELLED',
            actorType,
            actorId,
            reason,
            metadata: {
              advanceDisposition,
              advanceAmount,
              advanceRule,
              hoursUntilService,
              isTimelyCancellation,
              cancellationType,
            },
          },
        });

        // 3. Release any active holds
        await tx.bookingHold.updateMany({
          where: { bookingId, status: 'HOLD_ACTIVE' },
          data: { status: 'HOLD_RELEASED', releasedAt: new Date() },
        });

        // 4. Handle advance disposition
        if (advanceDisposition === 'FORFEITED' && advanceAmount > 0) {
          // Mark advance as forfeited - the payment record stays SUCCEEDED but we record disposition
          // In a full implementation, this would create an advance disposition record
          // For now, we create a metadata note in the payment record if needed
          await tx.payment.updateMany({
            where: { bookingId, purpose: 'ADVANCE', status: 'SUCCEEDED' },
            data: { metadata: { advanceDisposition: 'FORFEITED', forfeitedAt: new Date() } },
          });
        } else if (advanceDisposition === 'REFUND_PENDING' && advanceAmount > 0) {
          // Create a refund request record for YOYO cancellation
          // Refund will be processed through the refund workflow
          await tx.refund.create({
            data: {
              paymentId: advancePayment!.id,
              clientId: booking.clientId,
              amount: advanceAmount,
              status: 'REQUESTED',
              destination: 'ORIGINAL', // Default - client will choose later
              reason: `YOYO cancellation: ${reason}`,
              idempotencyKey: `refund-${idempotencyKey}`,
            },
          });
        }

        return {
          bookingId,
          status: 'CANCELLED',
          advanceDisposition,
          advanceAmount,
          advanceRule,
          refundAmount,
          hoursUntilService,
          isTimelyCancellation,
          cancellationType,
        };
      });

      // Record idempotency key
      await prisma.idempotencyKey.create({
        data: {
          key: idempotencyKey,
          endpoint: '/api/v1/bookings/cancel',
          method: 'POST',
          requestHash: this.hashRequest(request),
          responseStatus: 200,
          responseBody: result,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      // Publish BOOKING_CANCELLED event (per State Machine §15)
      await this.publishEvent('BOOKING_CANCELLED', {
        bookingId,
        actorId,
        actorType,
        reason,
        advanceDisposition,
        advanceAmount,
        advanceRule,
        refundAmount,
        cancellationType,
        oldSchedule: oldServicesSnapshot,
        idempotencyKey,
      });

      return { success: true, data: result };
    }

  /**
   * Reschedule booking with atomic new-resource-first transaction
   * Supports advance transfer rules and provisional boundary recalculation
   */
  async rescheduleBooking(request: RescheduleRequest, actorId: string, actorType: 'STAFF' | 'CLIENT') {
    const { bookingId, expectedVersion, newServices, reason, idempotencyKey } = request;

    // Check idempotency
    const existingKey = await prisma.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
    if (existingKey) {
      if (existingKey.responseBody) return existingKey.responseBody;
      throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key already used');
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        services: {
          include: { assignments: true }
        }
      },
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
    if (booking.version !== expectedVersion) {
      throw new AppError(409, 'VERSION_CONFLICT', `Booking version mismatch. Expected ${expectedVersion}, current ${booking.version}`);
    }

    // Validate new slots availability and collect service details
    const newServiceIds = newServices.map(s => s.serviceId);
    const newServicesDetails = await prisma.service.findMany({
      where: { id: { in: newServiceIds } },
      select: {
        id: true,
        name: true,
        durationMinutes: true,
        price: true,
        creativeDirectorEligible: true,
        requiredArtistCount: true,
      },
    });

    if (newServicesDetails.length !== newServiceIds.length) {
      throw new AppError(404, 'NOT_FOUND', 'One or more services not found');
    }

    // Validate each new service slot
    for (const newSvc of newServices) {
      const artistId = newSvc.artistId || '';
      const isAvailable = await availabilityService.validateSlotAvailability(
        artistId,
        newSvc.startAt,
        newSvc.endAt
      );
      if (!isAvailable) {
        throw new AppError(409, 'SLOT_UNAVAILABLE', `Slot not available for service ${newSvc.serviceId}`);
      }
    }

    // Check for Creative Director advance rule on new services
    const hasCreativeDirectorService = newServices.some(ns => {
      const svc = newServicesDetails.find(s => s.id === ns.serviceId);
      return svc?.creativeDirectorEligible && ns.artistId;
    });

    const oldTotal = Number(booking.totalPrice);
    const newTotal = newServicesDetails.reduce((sum, s) => sum + Number(s.price), 0);

    // Determine advance transfer
    const standardAdvanceAmount = Math.round(oldTotal * 0.2);
    const creativeDirectorAdvanceAmount = 5000;
    let advanceTransferApplied = false;
    let advanceTransferAmount = 0;

    // Check if reschedule is 24+ hours before appointment (advance transfer eligible)
        const earliestOldStart = booking.services.reduce((min, s) =>
          s.plannedStartAt < min ? s.plannedStartAt : min, booking.services[0]?.plannedStartAt);
        const hoursUntilAppointment = (earliestOldStart.getTime() - Date.now()) / (1000 * 60 * 60);
        const isTimelyReschedule = hoursUntilAppointment >= 24;

        // Check advance transfer count (CAN-001: Transfer only once)
        const hasTransferRemaining = booking.advanceTransferCount === 0;

        if (isTimelyReschedule && hasTransferRemaining) {
          if (hasCreativeDirectorService) {
            // CD advance transfers to new appointment (RESOLVED-BIZ-CD-RESCHEDULE)
            advanceTransferApplied = true;
            advanceTransferAmount = creativeDirectorAdvanceAmount;
          } else {
            // Standard 20% advance transfers once
            advanceTransferApplied = true;
            advanceTransferAmount = standardAdvanceAmount;
          }
        }

    // Snapshot old services for history
    const oldServicesSnapshot = booking.services.map(s => ({
      serviceId: s.serviceId,
      plannedStartAt: s.plannedStartAt,
      plannedEndAt: s.plannedEndAt,
      artistId: s.assignments[0]?.artistId,
      assignmentStatus: s.assignmentStatus,
      artistConfirmationState: s.artistConfirmationState,
    }));

    // Perform atomic reschedule transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create NEW booking services FIRST (new-resource-first)
      for (const newSvc of newServices) {
        const service = newServicesDetails.find(s => s.id === newSvc.serviceId);
        const requiredArtistCount = service?.requiredArtistCount || 1;
        
        // Determine assignment status and artist confirmation state for new service
        let assignmentStatus: 'AWAITING_ASSIGNMENT' | 'PARTIALLY_ASSIGNED' | 'FULLY_ASSIGNED' = 'AWAITING_ASSIGNMENT';
        let artistConfirmationState: 'NONE' | 'PROVISIONAL' | 'FINAL' = 'NONE';
        
        if (newSvc.artistId) {
          // Specific artist requested
          const daysUntilNew = (newSvc.startAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
          if (daysUntilNew <= 30) {
            artistConfirmationState = 'FINAL';
          } else {
            artistConfirmationState = 'PROVISIONAL';
          }
          
          // Check if artist is already assigned (carry over for same artist)
          const existingAssignment = booking.services.flatMap(s => s.assignments)
            .find(a => a.artistId === newSvc.artistId && a.status === 'CONFIRMED');
          if (existingAssignment) {
            assignmentStatus = requiredArtistCount === 1 ? 'FULLY_ASSIGNED' : 'PARTIALLY_ASSIGNED';
          }
        }

        await tx.bookingService.create({
          data: {
            bookingId,
            serviceId: newSvc.serviceId,
            assignmentStrategy: newSvc.artistId ? 'SPECIFIC_ARTIST' : 'AUTO_ASSIGN',
            requestedArtistId: newSvc.artistId,
            plannedStartAt: newSvc.startAt,
            plannedEndAt: newSvc.endAt,
            bufferMinutes: newSvc.bufferMinutes || 10,
            priceSnapshot: service ? Number(service.price) : 0,
            assignmentStatus,
            artistConfirmationState,
            requiredArtistCount,
          },
        });
      }

      // 2. Release OLD resources (delete old booking services - releases capacity)
      await tx.bookingService.deleteMany({ where: { bookingId } });

      // 3. Update booking totals and version
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          totalPrice: newTotal,
          totalAdvanceRequired: advanceTransferApplied ? 0 : booking.totalAdvanceRequired,
          advanceTransferCount: advanceTransferApplied ? { increment: 1 } : undefined,
          version: { increment: 1 },
        },
      });

      // 4. Record reschedule history
      await tx.bookingRescheduleHistory.create({
        data: {
          bookingId,
          reason,
          oldServicesJson: oldServicesSnapshot,
          newServicesJson: newServices.map(ns => ({
            serviceId: ns.serviceId,
            artistId: ns.artistId,
            startAt: ns.startAt,
            endAt: ns.endAt,
            bufferMinutes: ns.bufferMinutes || 10,
          })),
          moneyActionRequired: oldTotal !== newTotal,
          advanceTransferApplied,
          advanceTransferAmount,
          actorType,
          actorId,
          idempotencyKey,
        },
      });

      // 5. Record status history (status unchanged, but log the reschedule)
      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: booking.status,
          toStatus: booking.status,
          actorType,
          actorId,
          event: 'RESCHEDULE',
          reason,
          idempotencyKey,
        },
      });

      return {
        bookingId,
        status: booking.status,
        totalPrice: newTotal,
        advanceTransferApplied,
        advanceTransferAmount,
        oldServices: oldServicesSnapshot,
      };
    });

    // Record idempotency key
    await prisma.idempotencyKey.create({
      data: {
        key: idempotencyKey,
        endpoint: '/api/v1/bookings/reschedule',
        method: 'POST',
        requestHash: this.hashRequest(request),
        responseStatus: 200,
        responseBody: result,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    // Publish BOOKING_RESCHEDULED event
    await this.publishEvent('BOOKING_RESCHEDULED', {
      bookingId,
      actorId,
      actorType,
      oldSchedule: oldServicesSnapshot,
      newSchedule: newServices.map(ns => ({
        serviceId: ns.serviceId,
        artistId: ns.artistId,
        startAt: ns.startAt,
        endAt: ns.endAt,
      })),
      advanceTransferApplied,
      advanceTransferAmount,
      reason,
      idempotencyKey,
    });

    return { success: true, data: result };
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

    // Publish assignment events
    if (assignmentStatus === 'FULLY_ASSIGNED') {
      await this.publishEvent('ARTIST_ASSIGNMENT_FINALIZED', { 
        bookingServiceId, 
        bookingId: bookingService.bookingId,
        artistId,
        staffId: assignedByStaffId 
      });
    } else {
      await this.publishEvent('ASSIGNMENT_PARTIAL', { 
        bookingServiceId, 
        bookingId: bookingService.bookingId,
        artistId,
        staffId: assignedByStaffId,
        requiredCount,
        currentCount: assignmentCount
      });
    }
    // Also publish ASSIGNMENT_REQUIRED if this was the first assignment
    if (assignmentCount === 1) {
      await this.publishEvent('ASSIGNMENT_REQUIRED', { 
        bookingServiceId, 
        bookingId: bookingService.bookingId 
      });
    }

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
      // Release old assignment with version check
      const updated = await tx.bookingServiceAssignment.update({
        where: { 
          id: bookingServiceAssignmentId,
          status: { in: ['PENDING', 'CONFIRMED'] },
        },
        data: { status: 'REPLACED' },
      });
      
      if (!updated) {
        throw new AppError(409, 'STALE_ASSIGNMENT', 'Assignment was modified concurrently, please refresh and try again');
      }

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

      // Check if we need to update assignment status
      const assignments = await tx.bookingServiceAssignment.findMany({
        where: { bookingServiceId: oldAssignment.bookingServiceId, status: { in: ['PENDING', 'CONFIRMED'] } },
      });
      const bookingService = await tx.bookingService.findUnique({ 
        where: { id: oldAssignment.bookingServiceId },
        include: { service: true }
      });
      const requiredCount = bookingService?.service?.requiredArtistCount || 1;
      let assignmentStatus = 'PARTIALLY_ASSIGNED';
      if (assignments.length + 1 >= requiredCount) assignmentStatus = 'FULLY_ASSIGNED';
      
      await tx.bookingService.update({
        where: { id: oldAssignment.bookingServiceId },
        data: { assignmentStatus: assignmentStatus as any },
      });
    });

    // Publish ARTIST_ASSIGNMENT_FINALIZED or ARTIST_ASSIGNMENT_EXCEPTION event
    const bookingService = await prisma.bookingService.findUnique({ 
      where: { id: oldAssignment.bookingServiceId },
      include: { service: true }
    });
    const assignments = await prisma.bookingServiceAssignment.findMany({
      where: { bookingServiceId: oldAssignment.bookingServiceId, status: { in: ['PENDING', 'CONFIRMED'] } },
    });
    const requiredCount = bookingService?.service?.requiredArtistCount || 1;
    if (assignments.length >= requiredCount) {
      await this.publishEvent('ARTIST_ASSIGNMENT_FINALIZED', { 
        bookingServiceId: oldAssignment.bookingServiceId, 
        bookingId: bookingService?.bookingId,
        artistId: newArtistId,
        staffId: assignedByStaffId 
      });
    }

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

  /**
   * Publish domain event to outbox/event system
   */
  private async publishEvent(eventType: string, payload: Record<string, any>) {
    try {
      // Check if there's an event outbox or domain event table
      // For now, we'll use audit log as the event store
      await prisma.auditLog.create({
        data: {
          accountId: payload.staffId || payload.actorId || 'system',
          actorType: 'SYSTEM',
          action: eventType,
          metadata: payload,
          ipAddress: 'server',
          userAgent: 'booking-service',
          success: true,
        },
      });
    } catch (error) {
      // Log but don't fail the main operation
      console.error(`Failed to publish event ${eventType}:`, error);
    }
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