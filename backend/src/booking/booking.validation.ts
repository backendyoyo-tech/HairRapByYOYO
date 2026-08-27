import { z } from 'zod';

// ============================================================
// Availability Search Validation Schemas
// ============================================================

export const AvailabilitySearchQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  serviceIds: z.string().min(1, 'At least one serviceId is required').transform((val) => val.split(',').map((s) => s.trim())),
  artistId: z.string().cuid().optional(),
  preferredStartWindow: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format').optional(),
  preferredEndWindow: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format').optional(),
  partySize: z.coerce.number().int().positive().default(1),
});

export type AvailabilitySearchQuery = z.infer<typeof AvailabilitySearchQuerySchema>;

// ============================================================
// Booking Quote Validation Schemas
// ============================================================

export const BookingQuoteItemSchema = z.object({
  serviceId: z.string().cuid(),
  requestedArtistId: z.string().cuid().optional(),
  assignmentStrategy: z.enum(['SPECIFIC_ARTIST', 'AUTO_ASSIGN', 'YOYO_ASSIGNED_TEAM']),
  preferredStartAt: z.string().datetime().optional(),
});

export const CreateBookingQuoteBodySchema = z.object({
  clientId: z.string().cuid(),
  items: z.array(BookingQuoteItemSchema).min(1, 'At least one service item required'),
  idempotencyKey: z.string().min(1).max(64).optional(),
});

export type CreateBookingQuoteBody = z.infer<typeof CreateBookingQuoteBodySchema>;

// ============================================================
// Booking Hold Validation Schemas
// ============================================================

export const CreateBookingHoldBodySchema = z.object({
  quoteId: z.string().cuid(),
  idempotencyKey: z.string().min(1).max(64),
});

export type CreateBookingHoldBody = z.infer<typeof CreateBookingHoldBodySchema>;

export const BookingHoldParamsSchema = z.object({
  id: z.string().cuid(),
});

export type BookingHoldParams = z.infer<typeof BookingHoldParamsSchema>;

// ============================================================
// Booking Validation Schemas
// ============================================================

export const CreateBookingBodySchema = z.object({
  holdId: z.string().cuid(),
  idempotencyKey: z.string().min(1).max(64).optional(),
});

export type CreateBookingBody = z.infer<typeof CreateBookingBodySchema>;

export const BookingParamsSchema = z.object({
  id: z.string().cuid(),
});

export type BookingParams = z.infer<typeof BookingParamsSchema>;

// ============================================================
// Booking Cancellation Validation Schemas
// ============================================================

export const CancelBookingBodySchema = z.object({
  reason: z.string().min(1).max(500),
  actorType: z.enum(['STAFF', 'CLIENT']),
  actorId: z.string().cuid(),
});

export type CancelBookingBody = z.infer<typeof CancelBookingBodySchema>;

// ============================================================
// Booking Reschedule Validation Schemas
// ============================================================

export const RescheduleBookingItemSchema = z.object({
  bookingServiceId: z.string().cuid(),
  newStartAt: z.string().datetime(),
  newEndAt: z.string().datetime(),
  newArtistId: z.string().cuid().optional(),
});

export const RescheduleBookingBodySchema = z.object({
  reason: z.string().min(1).max(500),
  actorType: z.enum(['STAFF', 'CLIENT']),
  actorId: z.string().cuid(),
  items: z.array(RescheduleBookingItemSchema).min(1),
  idempotencyKey: z.string().min(1).max(64),
});

export type RescheduleBookingBody = z.infer<typeof RescheduleBookingBodySchema>;

// ============================================================
// Artist Assignment Validation Schemas
// ============================================================

export const AssignArtistBodySchema = z.object({
  bookingServiceId: z.string().cuid(),
  artistId: z.string().cuid(),
  role: z.enum(['PRIMARY', 'LEAD', 'SUPPORT']),
  assignmentSource: z.enum(['CLIENT_REQUEST', 'FLOOR_MANAGER', 'RECEPTIONIST', 'AUTO_STANDARD_RESERVED_P2']),
  assignedByStaffId: z.string().cuid().optional(),
});

export type AssignArtistBody = z.infer<typeof AssignArtistBodySchema>;

export const ReleaseArtistAssignmentBodySchema = z.object({
  bookingServiceAssignmentId: z.string().cuid(),
  reason: z.string().min(1).max(500),
  actorType: z.enum(['STAFF', 'SYSTEM']),
  actorId: z.string().cuid(),
});

export type ReleaseArtistAssignmentBody = z.infer<typeof ReleaseArtistAssignmentBodySchema>;

// ============================================================
// Artist Schedule Validation Schemas
// ============================================================

export const CreateArtistWorkScheduleBodySchema = z.object({
  artistId: z.string().cuid(),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),
  isActive: z.boolean().default(true),
});

export type CreateArtistWorkScheduleBody = z.infer<typeof CreateArtistWorkScheduleBodySchema>;

export const CreateArtistScheduleExceptionBodySchema = z.object({
  artistId: z.string().cuid(),
  exceptionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format').optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format').optional(),
  reason: z.string().max(500).optional(),
  isAvailable: z.boolean().default(false),
});

export type CreateArtistScheduleExceptionBody = z.infer<typeof CreateArtistScheduleExceptionBodySchema>;

export const ArtistScheduleParamsSchema = z.object({
  artistId: z.string().cuid(),
});

export type ArtistScheduleParams = z.infer<typeof ArtistScheduleParamsSchema>;

// ============================================================
// Service Session Validation Schemas
// ============================================================

export const StartServiceSessionBodySchema = z.object({
  bookingServiceId: z.string().cuid(),
  idempotencyKey: z.string().min(1).max(64),
});

export type StartServiceSessionBody = z.infer<typeof StartServiceSessionBodySchema>;

export const CompleteServiceSessionBodySchema = z.object({
  bookingServiceId: z.string().cuid(),
  idempotencyKey: z.string().min(1).max(64),
});

export type CompleteServiceSessionBody = z.infer<typeof CompleteServiceSessionBodySchema>;

// ============================================================
// Query Parameters for List Endpoints
// ============================================================

export const ListBookingsQuerySchema = z.object({
  clientId: z.string().cuid().optional(),
  status: z.enum(['CONFIRMED', 'CHECKED_IN', 'IN_SERVICE', 'SERVICE_COMPLETED', 'CLOSED', 'CANCELLED', 'NO_SHOW']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type ListBookingsQuery = z.infer<typeof ListBookingsQuerySchema>;

export const ListArtistScheduleQuerySchema = z.object({
  artistId: z.string().cuid(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type ListArtistScheduleQuery = z.infer<typeof ListArtistScheduleQuerySchema>;