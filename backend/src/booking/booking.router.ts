import { Router } from 'express';
import { bookingController } from './booking.controller.js';
import { requireAuth, requireRole } from '../auth/actor.middleware.js';
import { idempotencyMiddleware } from '../shared/middleware/idempotency.middleware.js';

const router = Router();

// ============================================================
// PUBLIC / CLIENT AUTHENTICATED ENDPOINTS
// ============================================================

// Availability search - public (for booking widget)
router.get('/availability/search', bookingController.searchAvailability);

// Booking quotes - client authenticated
router.post('/booking-quotes', requireAuth, requireRole('CLIENT', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN'), bookingController.createQuote);
router.get('/booking-quotes/:quoteId', requireAuth, requireRole('CLIENT', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN'), bookingController.getQuote);

// Booking holds - client authenticated with idempotency
router.post('/booking-holds', requireAuth, requireRole('CLIENT', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN'), idempotencyMiddleware, bookingController.createHold);
router.get('/booking-holds/:holdId', requireAuth, requireRole('CLIENT', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN'), bookingController.getHold);
router.post('/booking-holds/:holdId/release', requireAuth, requireRole('CLIENT', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN'), bookingController.releaseHold);

// Create booking from hold - client authenticated with idempotency
router.post('/bookings/from-hold', requireAuth, requireRole('CLIENT', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN'), idempotencyMiddleware, bookingController.createBookingFromHold);

// Booking management - client authenticated
router.get('/bookings', requireAuth, requireRole('CLIENT', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN', 'ARTIST'), bookingController.listBookings);
router.get('/bookings/:bookingId', requireAuth, requireRole('CLIENT', 'ARTIST', 'SUPER_ADMIN', 'ADMIN', 'RECEPTIONIST'), bookingController.getBooking);
router.post('/bookings/:bookingId/cancel', requireAuth, requireRole('CLIENT', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN'), bookingController.cancelBooking);
router.post('/bookings/:bookingId/reschedule', requireAuth, requireRole('CLIENT', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN'), idempotencyMiddleware, bookingController.rescheduleBooking);

// ============================================================
// STAFF ONLY ENDPOINTS
// ============================================================

// Artist assignment - receptionist/admin/super_admin
router.post('/booking-services/:bookingServiceId/assign', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'RECEPTIONIST'), bookingController.assignArtist);
router.post('/booking-service-assignments/:assignmentId/reassign', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'RECEPTIONIST'), bookingController.reassignArtist);

// State machine transitions - receptionist/admin/super_admin
router.post('/bookings/:bookingId/transition', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN', 'RECEPTIONIST'), bookingController.transitionState);

export const bookingRouter = router;