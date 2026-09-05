import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from "../shared/errors/index.js";
import { availabilityService, AvailabilitySearchRequest } from "./availability.service.js";
import { bookingQuoteService, BookingQuoteRequest } from "./booking-quote.service.js";
import { bookingHoldService, CreateHoldRequest, HoldResourceInput } from "./booking-hold.service.js";
import { bookingService, CreateBookingFromHoldRequest, RescheduleRequest, AssignArtistRequest, ReassignArtistRequest } from "./booking.service.js";
import { paymentService, CreateAdvanceOrderRequest, VerifyPaymentRequest } from "./payment.service.js";
import { t30ConfirmationService, ConfirmProvisionalRequest, ResolveUnavailableArtistRequest } from "./t30-confirmation.service.js";
import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { requireAuth, requireRole } from "../auth/actor.middleware.js";
import { AvailabilitySearchQuerySchema } from './booking.validation.js';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ============================================================
// ZOD VALIDATION SCHEMAS
// ============================================================

const BookingQuoteSchema = z.object({
  clientId: z.string().min(1, 'clientId is required'),

  serviceItems: z.array(z.object({
    serviceId: z.string(),
    requestedArtistId: z.string().optional(),
    assignmentStrategy: z.enum(['SPECIFIC_ARTIST', 'AUTO_ASSIGN', 'YOYO_ASSIGNED_TEAM']),
  })).min(1, 'At least one service item required'),

  date: z.string().datetime().transform(s => new Date(s)),

  partySize: z.coerce.number().int().positive().optional().default(1),
});

// const CreateHoldSchema = z.object({
//   quoteId: z.string(),

//   resources: z.array(z.object({
//     serviceIndex: z.number().int().nonnegative(),
//     artistId: z.string().optional(),
//     startAt: z.string().datetime().transform(s => new Date(s)),
//     endAt: z.string().datetime().transform(s => new Date(s)),
//   })).min(1, 'At least one resource required'),
//   idempotencyKey: z.string().min(1, 'Idempotency key required'),
// });

const CreateHoldSchema = z.object({
  clientId: z.string().min(1, 'clientId is required'),

  quoteId: z.string(),

  resources: z.array(z.object({
    serviceIndex: z.number().int().nonnegative(),
    artistId: z.string().optional(),
    startAt: z.string().datetime().transform(s => new Date(s)),
    endAt: z.string().datetime().transform(s => new Date(s)),
  })).min(1, 'At least one resource required'),

  idempotencyKey: z.string().min(1, 'Idempotency key required'),
});



const CreateBookingFromHoldSchema = z.object({
  holdId: z.string(),
  idempotencyKey: z.string().min(1, 'Idempotency key required'),
});

const AdvanceOrderSchema = z.object({
  holdId: z.string(),
  idempotencyKey: z.string().min(1, 'Idempotency key required'),
});

const VerifyPaymentSchema = z.object({
  holdId: z.string(),
  razorpayPaymentId: z.string(),
  razorpayOrderId: z.string(),
  razorpaySignature: z.string(),
  idempotencyKey: z.string().min(1, 'Idempotency key required'),
});

const RescheduleSchema = z.object({
  expectedVersion: z.number().int().positive(),
  newServices: z.array(z.object({
    serviceId: z.string(),
    artistId: z.string().optional(),
    startAt: z.string().datetime().transform(s => new Date(s)),
    endAt: z.string().datetime().transform(s => new Date(s)),
    bufferMinutes: z.number().int().nonnegative().optional().default(10),
  })).min(1),
  reason: z.string().min(1, 'Reason required'),
  idempotencyKey: z.string().min(1, 'Idempotency key required'),
});

const CancelSchema = z.object({
  reason: z.string().min(1, 'Cancellation reason required'),
});

const CheckInSchema = z.object({
  reason: z.string().optional(),
});

const NoShowSchema = z.object({
  reason: z.string().optional(),
});

const AssignArtistSchema = z.object({
  artistId: z.string(),
  role: z.enum(['PRIMARY', 'LEAD', 'SUPPORT']),
  assignmentSource: z.enum(['CLIENT_REQUEST', 'FLOOR_MANAGER', 'RECEPTIONIST', 'AUTO_STANDARD_RESERVED_P2']),
  assignedByStaffId: z.string().optional(),
});

const ReassignArtistSchema = z.object({
  newArtistId: z.string(),
  assignedByStaffId: z.string(),
});

const BookingListQuerySchema = z.object({
  status: z.string().optional().transform(s => s ? s.split(',') : undefined),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  fromDate: z.string().datetime().transform(s => new Date(s)).optional(),
  toDate: z.string().datetime().transform(s => new Date(s)).optional(),
});

const TransitionStateSchema = z.object({
  toStatus: z.enum(['CHECKED_IN', 'IN_SERVICE', 'SERVICE_COMPLETED', 'CLOSED', 'CANCELLED', 'NO_SHOW']),
  reason: z.string().optional(),
});

const WebhookSchema = z.object({
  event: z.string(),
  payload: z.any(),
});

const ConfirmProvisionalSchema = z.object({
  idempotencyKey: z.string().min(1, 'Idempotency key required'),
});

const ResolveUnavailableArtistSchema = z.object({
  recoveryOption: z.object({
    type: z.enum(['SAME_ARTIST_DIFFERENT_TIME', 'SAME_TIME_DIFFERENT_ARTIST']),
    newStartAt: z.string().datetime().transform(s => new Date(s)).optional(),
    newEndAt: z.string().datetime().transform(s => new Date(s)).optional(),
    newArtistId: z.string().optional(),
  }),
  idempotencyKey: z.string().min(1, 'Idempotency key required'),
});

// ============================================================
// CONTROLLER
// ============================================================

export class BookingController {
  /**
   * POST /api/v1/availability/search
   * Search available artist slots for services on a date
   */
  async searchAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      // Validate public API request
      const body = AvailabilitySearchQuerySchema.parse(req.body);

      // Convert YYYY-MM-DD into the Date format expected by availabilityService
      const requestedStartDate = new Date(`${body.date}T00:00:00`);

      // Convert public API shape into internal availability service shape
      const availabilityRequest: AvailabilitySearchRequest = {
        requestedStartDate,

        services: body.serviceIds.map((serviceId) => ({
          serviceId,
          ...(body.artistId
            ? { requestedArtistId: body.artistId }
            : {}),
        })),

        groupContext: {
          participantCount: body.partySize,
        },
      };

      const result = await availabilityService.searchAvailability(
        availabilityRequest
      );

      // Apply preferred time-window filters to generated slots
      const filteredResult = result.map((serviceResult) => {
        const slots = serviceResult.slots.filter((slot) => {
          const hours = slot.startAt.getHours().toString().padStart(2, '0');
          const minutes = slot.startAt.getMinutes().toString().padStart(2, '0');
          const slotTime = `${hours}:${minutes}`;

          if (
            body.preferredStartWindow &&
            slotTime < body.preferredStartWindow
          ) {
            return false;
          }

          if (
            body.preferredEndWindow &&
            slotTime >= body.preferredEndWindow
          ) {
            return false;
          }

          return true;
        });

        const page = 1;
        const limit = 50;
        const total = slots.length;
        const totalPages = Math.ceil(total / limit);

        return {
          ...serviceResult,
          slots: slots.slice(0, limit),
          pagination: {
            page,
            limit,
            total,
            totalPages,
          },
        };
      });

      return res.status(200).json({
        success: true,
        data: filteredResult,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/booking-quotes
   * Generate a booking quote with pricing and availability
   */
  async createQuote(req: Request, res: Response, next: NextFunction) {
    try {
      const body = BookingQuoteSchema.parse(req.body);
      const clientId = body.clientId;

      if (!clientId) {
        throw new AppError(400, 'INVALID_REQUEST', 'clientId is required');
      }
      const request: BookingQuoteRequest = {
        serviceItems: body.serviceItems,
        date: body.date,
        partySize: body.partySize,
      };

      const quote = await bookingQuoteService.createQuote(request, clientId);

      res.status(201).json({
        success: true,
        data: quote,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/booking-quotes/:quoteId
   * Get quote details
   */
  async getQuote(req: Request, res: Response, next: NextFunction) {
    try {
      const clientId = (req as any).user?.clientProfileId || (req as any).user?.accountId;
      const { quoteId } = req.params as { quoteId: string };

      const quote = await bookingQuoteService.getQuote(quoteId);
      if (!quote) {
        throw new AppError(404, 'NOT_FOUND', 'Quote not found');
      }
      if (quote.services[0] && quote.services[0].availableSlots.length === 0) {
        // Quote belongs to client check would need quote.clientId in response
      }

      res.json({
        success: true,
        data: quote,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/booking-holds
   * Create a booking hold from a quote
   */
  async createHold(req: Request, res: Response, next: NextFunction) {
    try {
      const body = CreateHoldSchema.parse(req.body);

      const clientId = body.clientId;

      if (!clientId) {
        throw new AppError(400, 'INVALID_REQUEST', 'clientId is required');
      }
      const request: CreateHoldRequest = {
        quoteId: body.quoteId,
        resources: body.resources,
        idempotencyKey: body.idempotencyKey,
      };

      const hold = await bookingHoldService.createHold(request, clientId);

      res.status(201).json({
        success: true,
        data: hold,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/booking-holds/:holdId
   * Get hold details
   */
  // async getHold(req: Request, res: Response, next: NextFunction) {
  //   try {
  //     const clientId = (req as any).user?.clientProfileId || (req as any).user?.accountId;
  //     const { holdId } = req.params as { holdId: string };

  //     const hold = await bookingHoldService.getHold(holdId, clientId);

  //     res.json({
  //       success: true,
  //       data: hold,
  //     });
  //   } catch (error) {
  //     next(error);
  //   }
  // }

  async getHold(req: Request, res: Response, next: NextFunction) {
    try {
      const { holdId } = req.params as { holdId: string };
      const actor = (req as any).actor;

      const isStaff =
        actor?.actorType === 'STAFF' ||
        ['ADMIN', 'SUPER_ADMIN', 'RECEPTIONIST'].includes(actor?.role);

      const clientId = actor?.actorType === 'CLIENT'
        ? actor.actorId
        : undefined;

      const hold = await bookingHoldService.getHold(
        holdId,
        clientId,
        isStaff
      );

      res.json({
        success: true,
        data: hold,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/booking-holds/:holdId/release
   * Release a hold early
   */
  async releaseHold(req: Request, res: Response, next: NextFunction) {
    try {
      const clientId = (req as any).user?.clientProfileId || (req as any).user?.accountId;
      const { holdId } = req.params as { holdId: string };

      await bookingHoldService.releaseHold(holdId, clientId);

      res.json({
        success: true,
        data: { message: 'Hold released' },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/bookings/from-hold
   * Create booking from consumed hold
   */
  async createBookingFromHold(req: Request, res: Response, next: NextFunction) {
    try {
      const clientId = (req as any).user?.clientProfileId || (req as any).user?.accountId;
      if (!clientId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Client authentication required');
      }

      const body = CreateBookingFromHoldSchema.parse(req.body);
      const request: CreateBookingFromHoldRequest = {
        holdId: body.holdId,
        idempotencyKey: body.idempotencyKey,
      };

      const result = await bookingService.createBookingFromHold(request, clientId);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/bookings
   * List bookings for authenticated client
   */
  async listBookings(req: Request, res: Response, next: NextFunction) {
    try {
      const clientId = (req as any).user?.clientProfileId || (req as any).user?.accountId;
      if (!clientId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Client authentication required');
      }

      const query = BookingListQuerySchema.parse(req.query);
      const result = await bookingService.listBookings(clientId, query);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/bookings/:bookingId
   * Get booking details
   */
  async getBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const requesterId = (req as any).user?.accountId;
      const requesterRole = (req as any).user?.role;
      const { bookingId } = req.params as { bookingId: string };

      const booking = await bookingService.getBooking(bookingId, requesterId, requesterRole);

      res.json({
        success: true,
        data: booking,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/bookings/:bookingId/check-in
   * Check in client for booking
   */
  async checkInBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const staffId = (req as any).user?.staffProfileId || (req as any).user?.accountId;
      const { bookingId } = req.params as { bookingId: string };
      const body = CheckInSchema.parse(req.body);

      const result = await bookingService.checkInBooking(bookingId, staffId, body.reason);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/bookings/:bookingId/no-show
   * Mark booking as no-show
   */
  async markNoShow(req: Request, res: Response, next: NextFunction) {
    try {
      const staffId = (req as any).user?.staffProfileId || (req as any).user?.accountId;
      const { bookingId } = req.params as { bookingId: string };
      const body = NoShowSchema.parse(req.body);

      const result = await bookingService.markNoShow(bookingId, staffId, body.reason);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/bookings/:bookingId/cancel
   * Cancel booking
   */
  async cancelBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const clientId = (req as any).user?.clientProfileId || (req as any).user?.accountId;
      const { bookingId } = req.params as { bookingId: string };

      const body = CancelSchema.parse(req.body);

      const result = await bookingService.cancelBooking(bookingId, clientId, body.reason);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/bookings/:bookingId/reschedule
   * Reschedule booking with optimistic concurrency
   */
  async rescheduleBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const actorId = (req as any).user?.accountId;
      const actorType = (req as any).user?.role === 'CLIENT' ? 'CLIENT' : 'STAFF';
      const { bookingId } = req.params as { bookingId: string };

      const body = RescheduleSchema.parse(req.body);
      const request: RescheduleRequest = {
        bookingId,
        expectedVersion: body.expectedVersion,
        newServices: body.newServices,
        reason: body.reason,
        idempotencyKey: body.idempotencyKey,
      };

      const result = await bookingService.rescheduleBooking(request, actorId, actorType);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/booking-services/:bookingServiceId/assign
   * Assign artist to booking service (staff only)
   */
  async assignArtist(req: Request, res: Response, next: NextFunction) {
    try {
      const staffId = (req as any).user?.staffProfileId || (req as any).user?.accountId;
      const { bookingServiceId } = req.params as { bookingServiceId: string };

      const body = AssignArtistSchema.parse(req.body);
      const request: AssignArtistRequest = {
        bookingServiceId,
        artistId: body.artistId,
        role: body.role,
        assignmentSource: body.assignmentSource,
        assignedByStaffId: staffId,
      };

      const assignment = await bookingService.assignArtist(request, staffId);

      res.status(201).json({
        success: true,
        data: assignment,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/booking-service-assignments/:assignmentId/reassign
   * Reassign artist (staff only)
   */
  async reassignArtist(req: Request, res: Response, next: NextFunction) {
    try {
      const staffId = (req as any).user?.staffProfileId || (req as any).user?.accountId;
      const { assignmentId } = req.params as { assignmentId: string };

      const body = ReassignArtistSchema.parse(req.body);
      const request: ReassignArtistRequest = {
        bookingServiceAssignmentId: assignmentId,
        newArtistId: body.newArtistId,
        assignedByStaffId: staffId,
      };

      const result = await bookingService.reassignArtist(request, staffId);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/bookings/:bookingId/transition
   * State machine transition (staff only)
   */
  async transitionState(req: Request, res: Response, next: NextFunction) {
    try {
      const staffId = (req as any).user?.staffProfileId || (req as any).user?.accountId;
      const { bookingId } = req.params as { bookingId: string };

      const body = TransitionStateSchema.parse(req.body);
      const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
      if (!booking) {
        throw new AppError(404, 'NOT_FOUND', 'Booking not found');
      }

      await bookingService.transitionBookingState(
        bookingId,
        booking.status,
        body.toStatus,
        'STAFF',
        staffId,
        body.reason
      );

      res.json({
        success: true,
        data: { message: `Booking transitioned to ${body.toStatus}` },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/admin/assignment-queue
   * Get assignment queue for services needing manual assignment
   */
  async getAssignmentQueue(req: Request, res: Response, next: NextFunction) {
    try {
      const staffId = (req as any).user?.staffProfileId || (req as any).user?.accountId;

      const queue = await bookingService.getAssignmentQueue();

      res.json({
        success: true,
        data: queue,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/booking-holds/:holdId/advance-order
   * Create Razorpay advance order for hold
   */
  async createAdvanceOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const clientId = (req as any).user?.clientProfileId || (req as any).user?.accountId;
      if (!clientId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Client authentication required');
      }

      const { holdId } = req.params as { holdId: string };
      const body = AdvanceOrderSchema.parse(req.body);
      const request: CreateAdvanceOrderRequest = {
        holdId,
        idempotencyKey: body.idempotencyKey,
      };

      const order = await paymentService.createAdvanceOrder(request, clientId);

      res.status(201).json({
        success: true,
        data: order,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/booking-holds/:holdId/verify-payment
   * Verify payment and confirm booking
   */
  async verifyPayment(req: Request, res: Response, next: NextFunction) {
    try {
      const clientId = (req as any).user?.clientProfileId || (req as any).user?.accountId;
      if (!clientId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Client authentication required');
      }

      const { holdId } = req.params as { holdId: string };
      const body = VerifyPaymentSchema.parse(req.body);
      const request: VerifyPaymentRequest = {
        holdId,
        razorpayPaymentId: body.razorpayPaymentId,
        razorpayOrderId: body.razorpayOrderId,
        razorpaySignature: body.razorpaySignature,
        idempotencyKey: body.idempotencyKey,
      };

      const result = await paymentService.verifyPaymentAndConfirmBooking(request, clientId);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/webhooks/razorpay
   * Handle Razorpay webhook events
   */
  async handleRazorpayWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const signature = req.headers['x-razorpay-signature'] as string;
      const body = WebhookSchema.parse(req.body);

      await paymentService.handleRazorpayWebhook(body, signature);

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/payments/:paymentId
   * Get payment details
   */
  async getPayment(req: Request, res: Response, next: NextFunction) {
    try {
      const { paymentId } = req.params as { paymentId: string };

      const payment = await paymentService.getPayment(paymentId);
      if (!payment) {
        throw new AppError(404, 'NOT_FOUND', 'Payment not found');
      }

      res.json({
        success: true,
        data: payment,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/admin/t30/queue
   * Get T-30 provisional booking confirmation queue
   */
  async getT30Queue(req: Request, res: Response, next: NextFunction) {
    try {
      const staffId = (req as any).user?.staffProfileId || (req as any).user?.accountId;

      const queue = await t30ConfirmationService.getT30Queue();

      res.json({
        success: true,
        data: queue,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/admin/t30/confirm
   * Confirm provisional specific artist at T-30
   */
  async confirmProvisional(req: Request, res: Response, next: NextFunction) {
    try {
      const staffId = (req as any).user?.staffProfileId || (req as any).user?.accountId;
      const { bookingServiceId } = req.params as { bookingServiceId: string };
      const body = ConfirmProvisionalSchema.parse(req.body);

      const request: ConfirmProvisionalRequest = {
        bookingServiceId,
        idempotencyKey: body.idempotencyKey,
      };

      const result = await t30ConfirmationService.confirmProvisional(request, staffId);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/admin/t30/mark-exception
   * Mark provisional booking as exception (artist unavailable at T-30)
   */
  async markProvisionalException(req: Request, res: Response, next: NextFunction) {
    try {
      const staffId = (req as any).user?.staffProfileId || (req as any).user?.accountId;
      const { bookingServiceId } = req.params as { bookingServiceId: string };

      const result = await t30ConfirmationService.markProvisionalException(bookingServiceId, staffId);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/admin/t30/recovery-options
   * Get recovery options for unavailable artist
   */
  async getRecoveryOptions(req: Request, res: Response, next: NextFunction) {
    try {
      const { bookingServiceId } = req.params as { bookingServiceId: string };

      const options = await t30ConfirmationService.getRecoveryOptions(bookingServiceId);

      res.json({
        success: true,
        data: options,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/admin/t30/resolve-unavailable
   * Resolve unavailable artist for provisional booking (admin action with client choice)
   */
  async resolveUnavailableArtist(req: Request, res: Response, next: NextFunction) {
    try {
      const staffId = (req as any).user?.staffProfileId || (req as any).user?.accountId;
      const { bookingServiceId } = req.params as { bookingServiceId: string };
      const body = ResolveUnavailableArtistSchema.parse(req.body);

      const request: ResolveUnavailableArtistRequest = {
        bookingServiceId,
        recoveryOption: body.recoveryOption,
        idempotencyKey: body.idempotencyKey,
      };

      const result = await t30ConfirmationService.resolveUnavailableArtist(request, staffId);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const bookingController = new BookingController();