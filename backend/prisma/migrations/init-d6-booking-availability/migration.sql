-- D6 Booking & Availability Migration
-- Safe, non-destructive migration - only CREATE statements
-- No DROP TABLE, no ALTER TYPE on existing tables

-- ============================================================
-- ENUMS (Phase 1 Booking & Availability)
-- ============================================================

DO $$ BEGIN
    CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CHECKED_IN', 'IN_SERVICE', 'SERVICE_COMPLETED', 'CLOSED', 'CANCELLED', 'NO_SHOW');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "AssignmentStrategy" AS ENUM ('SPECIFIC_ARTIST', 'AUTO_ASSIGN', 'YOYO_ASSIGNED_TEAM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "AssignmentStatus" AS ENUM ('AWAITING_ASSIGNMENT', 'PARTIALLY_ASSIGNED', 'FULLY_ASSIGNED', 'ASSIGNMENT_EXCEPTION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "ArtistConfirmationState" AS ENUM ('NONE', 'PROVISIONAL', 'FINAL', 'CONFIRMATION_EXCEPTION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "AssignmentRole" AS ENUM ('PRIMARY', 'LEAD', 'SUPPORT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "AssignmentSource" AS ENUM ('CLIENT_REQUEST', 'FLOOR_MANAGER', 'RECEPTIONIST', 'AUTO_STANDARD_RESERVED_P2');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "AssignmentRowStatus" AS ENUM ('PENDING', 'CONFIRMED', 'RELEASED', 'REPLACED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "HoldStatus" AS ENUM ('HOLD_ACTIVE', 'HOLD_CONSUMED', 'HOLD_EXPIRED', 'HOLD_RELEASED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "SessionStatusEnum" AS ENUM ('NOT_STARTED', 'ACTIVE', 'READY_FOR_BILLING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "ConsultationReviewOutcome" AS ENUM ('NO_CHANGES', 'UPDATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "ConsentStatus" AS ENUM ('SIGNED', 'DECLINED', 'MISSING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "MediaConsent" AS ENUM ('ALLOW', 'DECLINE', 'NOT_ANSWERED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "PaymentPurpose" AS ENUM ('ADVANCE', 'FINAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "ReconciliationState" AS ENUM ('CLEAN', 'REQUIRED', 'IN_REVIEW', 'RESOLVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "RefundDestination" AS ENUM ('ORIGINAL', 'WALLET', 'MEMBERSHIP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "MembershipMemberStatus" AS ENUM ('ACTIVE', 'REMOVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "MembershipTxnType" AS ENUM ('PURCHASE_GRANT', 'SERVICE_DEBIT', 'REFUND_CREDIT', 'MANUAL_ADJUSTMENT', 'RENEWAL_RESERVED', 'EXPIRY_RESERVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "ExpenseApprovalStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'VOIDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "WebhookProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'DUPLICATE', 'FAILED_RETRYABLE', 'FAILED_FINAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- TABLES
-- ============================================================

-- Booking
CREATE TABLE IF NOT EXISTS "Booking" (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "clientId"              TEXT NOT NULL,
    status                  "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "assignmentStrategy"    "AssignmentStrategy" NOT NULL,
    "totalPrice"            NUMERIC(10, 2) NOT NULL,
    "totalAdvanceRequired"  NUMERIC(10, 2) NOT NULL,
    "advanceRule"           TEXT NOT NULL,
    version                 INTEGER NOT NULL DEFAULT 1,
    "confirmedAt"           TIMESTAMPTZ,
    "checkedInAt"           TIMESTAMPTZ,
    "cancelledAt"           TIMESTAMPTZ,
    "cancelReason"          TEXT,
    "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "Booking_clientId_status_idx" ON "Booking" ("clientId", status);
CREATE INDEX IF NOT EXISTS "Booking_status_idx" ON "Booking" (status);
CREATE INDEX IF NOT EXISTS "Booking_createdAt_idx" ON "Booking" ("createdAt");

-- BookingHold
CREATE TABLE IF NOT EXISTS "BookingHold" (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "bookingId"             TEXT,
    "clientId"              TEXT NOT NULL,
    "quoteId"               TEXT NOT NULL UNIQUE,
    status                  "HoldStatus" NOT NULL DEFAULT 'HOLD_ACTIVE',
    "expiresAt"             TIMESTAMPTZ NOT NULL,
    "totalAdvanceAmount"    NUMERIC(10, 2) NOT NULL,
    "advanceRule"           TEXT NOT NULL,
    "idempotencyKey"        TEXT NOT NULL UNIQUE,
    "consumedAt"            TIMESTAMPTZ,
    "releasedAt"            TIMESTAMPTZ,
    "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "BookingHold_clientId_status_idx" ON "BookingHold" ("clientId", status);
CREATE INDEX IF NOT EXISTS "BookingHold_status_expiresAt_idx" ON "BookingHold" (status, "expiresAt");
CREATE INDEX IF NOT EXISTS "BookingHold_quoteId_idx" ON "BookingHold" ("quoteId");

-- BookingHoldResource
CREATE TABLE IF NOT EXISTS "BookingHoldResource" (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "holdId"                TEXT NOT NULL,
    "bookingServiceId"      TEXT,
    "artistId"              TEXT,
    "resourceType"          TEXT NOT NULL,
    "startAt"               TIMESTAMPTZ NOT NULL,
    "endAt"                 TIMESTAMPTZ NOT NULL,
    "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "BookingHoldResource_holdId_artistId_startAt_endAt_key" ON "BookingHoldResource" ("holdId", "artistId", "startAt", "endAt");
CREATE INDEX IF NOT EXISTS "BookingHoldResource_holdId_idx" ON "BookingHoldResource" ("holdId");
CREATE INDEX IF NOT EXISTS "BookingHoldResource_artistId_startAt_endAt_idx" ON "BookingHoldResource" ("artistId", "startAt", "endAt");

-- BookingQuote
CREATE TABLE IF NOT EXISTS "BookingQuote" (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "clientId"              TEXT NOT NULL,
    services                JSONB NOT NULL,
    "serviceTotal"          NUMERIC(10, 2) NOT NULL,
    "advanceRule"           TEXT NOT NULL,
    "advanceRequired"       NUMERIC(10, 2) NOT NULL,
    "expiresAt"             TIMESTAMPTZ NOT NULL,
    warnings                JSONB,
    "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "BookingQuote_clientId_createdAt_idx" ON "BookingQuote" ("clientId", "createdAt");

-- BookingStatusHistory
CREATE TABLE IF NOT EXISTS "BookingStatusHistory" (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "bookingId"             TEXT NOT NULL,
    "fromStatus"            "BookingStatus",
    "toStatus"              "BookingStatus" NOT NULL,
    "actorType"             TEXT NOT NULL,
    "actorId"               TEXT,
    reason                  TEXT,
    metadata                JSONB,
    "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "BookingStatusHistory_bookingId_createdAt_idx" ON "BookingStatusHistory" ("bookingId", "createdAt");

-- BookingRescheduleHistory
CREATE TABLE IF NOT EXISTS "BookingRescheduleHistory" (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "bookingId"             TEXT NOT NULL,
    reason                  TEXT NOT NULL,
    "oldServicesJson"       JSONB NOT NULL,
    "newServicesJson"       JSONB NOT NULL,
    "moneyActionRequired"   BOOLEAN NOT NULL DEFAULT FALSE,
    "actorType"             TEXT NOT NULL,
    "actorId"               TEXT NOT NULL,
    "idempotencyKey"        TEXT NOT NULL UNIQUE,
    "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "BookingRescheduleHistory_bookingId_createdAt_idx" ON "BookingRescheduleHistory" ("bookingId", "createdAt");

-- ArtistWorkSchedule
CREATE TABLE IF NOT EXISTS "ArtistWorkSchedule" (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "artistId"              TEXT NOT NULL,
    "dayOfWeek"             INTEGER NOT NULL,
    "startTime"             TIMESTAMPTZ NOT NULL,
    "endTime"               TIMESTAMPTZ NOT NULL,
    "isActive"              BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "ArtistWorkSchedule_artistId_dayOfWeek_startTime_endTime_key" ON "ArtistWorkSchedule" ("artistId", "dayOfWeek", "startTime", "endTime");
CREATE INDEX IF NOT EXISTS "ArtistWorkSchedule_artistId_dayOfWeek_isActive_idx" ON "ArtistWorkSchedule" ("artistId", "dayOfWeek", "isActive");

-- ArtistScheduleException
CREATE TABLE IF NOT EXISTS "ArtistScheduleException" (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "artistId"              TEXT NOT NULL,
    "exceptionDate"         TIMESTAMPTZ NOT NULL,
    "startTime"             TIMESTAMPTZ,
    "endTime"               TIMESTAMPTZ,
    reason                  TEXT,
    "isAvailable"           BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "ArtistScheduleException_artistId_exceptionDate_startTime_endTime_key" ON "ArtistScheduleException" ("artistId", "exceptionDate", "startTime", "endTime");
CREATE INDEX IF NOT EXISTS "ArtistScheduleException_artistId_exceptionDate_idx" ON "ArtistScheduleException" ("artistId", "exceptionDate");
CREATE INDEX IF NOT EXISTS "ArtistScheduleException_exceptionDate_isAvailable_idx" ON "ArtistScheduleException" ("exceptionDate", "isAvailable");

-- IdempotencyKey
CREATE TABLE IF NOT EXISTS "IdempotencyKey" (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    key                     TEXT NOT NULL UNIQUE,
    endpoint                TEXT NOT NULL,
    method                  TEXT NOT NULL,
    "requestHash"           TEXT NOT NULL,
    "responseStatus"        INTEGER,
    "responseBody"          JSONB,
    "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT now(),
    "expiresAt"             TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS "IdempotencyKey_key_idx" ON "IdempotencyKey" (key);
CREATE INDEX IF NOT EXISTS "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey" ("expiresAt");

-- ============================================================
-- FOREIGN KEYS (only for new tables referencing existing tables)
-- ============================================================

-- Booking -> ClientProfile
ALTER TABLE "Booking" 
    ADD CONSTRAINT IF NOT EXISTS "Booking_clientId_fkey" 
    FOREIGN KEY ("clientId") REFERENCES "ClientProfile"(id) ON DELETE CASCADE;

-- BookingHold -> ClientProfile
ALTER TABLE "BookingHold" 
    ADD CONSTRAINT IF NOT EXISTS "BookingHold_clientId_fkey" 
    FOREIGN KEY ("clientId") REFERENCES "ClientProfile"(id) ON DELETE CASCADE;

-- BookingHold -> Booking
ALTER TABLE "BookingHold" 
    ADD CONSTRAINT IF NOT EXISTS "BookingHold_bookingId_fkey" 
    FOREIGN KEY ("bookingId") REFERENCES "Booking"(id) ON DELETE SET NULL;

-- BookingHoldResource -> BookingHold
ALTER TABLE "BookingHoldResource" 
    ADD CONSTRAINT IF NOT EXISTS "BookingHoldResource_holdId_fkey" 
    FOREIGN KEY ("holdId") REFERENCES "BookingHold"(id) ON DELETE CASCADE;

-- BookingHoldResource -> ArtistProfile (nullable)
ALTER TABLE "BookingHoldResource" 
    ADD CONSTRAINT IF NOT EXISTS "BookingHoldResource_artistId_fkey" 
    FOREIGN KEY ("artistId") REFERENCES "ArtistProfile"(id) ON DELETE SET NULL;

-- BookingStatusHistory -> Booking
ALTER TABLE "BookingStatusHistory" 
    ADD CONSTRAINT IF NOT EXISTS "BookingStatusHistory_bookingId_fkey" 
    FOREIGN KEY ("bookingId") REFERENCES "Booking"(id) ON DELETE CASCADE;

-- BookingRescheduleHistory -> Booking
ALTER TABLE "BookingRescheduleHistory" 
    ADD CONSTRAINT IF NOT EXISTS "BookingRescheduleHistory_bookingId_fkey" 
    FOREIGN KEY ("bookingId") REFERENCES "Booking"(id) ON DELETE CASCADE;

-- ArtistWorkSchedule -> ArtistProfile
ALTER TABLE "ArtistWorkSchedule" 
    ADD CONSTRAINT IF NOT EXISTS "ArtistWorkSchedule_artistId_fkey" 
    FOREIGN KEY ("artistId") REFERENCES "ArtistProfile"(id) ON DELETE CASCADE;

-- ArtistScheduleException -> ArtistProfile
ALTER TABLE "ArtistScheduleException" 
    ADD CONSTRAINT IF NOT EXISTS "ArtistScheduleException_artistId_fkey" 
    FOREIGN KEY ("artistId") REFERENCES "ArtistProfile"(id) ON DELETE CASCADE;

-- ============================================================
-- ALTER EXISTING TABLES FOR NEW ENUM TYPES
-- ============================================================

-- Update BookingService to use enum types
ALTER TABLE "BookingService" 
    ALTER COLUMN "assignmentStrategy" TYPE "AssignmentStrategy" USING "assignmentStrategy"::"AssignmentStrategy",
    ALTER COLUMN "executionStatus" TYPE "SessionStatusEnum" USING "executionStatus"::"SessionStatusEnum",
    ALTER COLUMN "assignmentStatus" TYPE "AssignmentStatus" USING "assignmentStatus"::"AssignmentStatus",
    ALTER COLUMN "artistConfirmationState" TYPE "ArtistConfirmationState" USING "artistConfirmationState"::"ArtistConfirmationState";

-- Update BookingServiceAssignment to use enum types
ALTER TABLE "BookingServiceAssignment" 
    ALTER COLUMN role TYPE "AssignmentRole" USING role::"AssignmentRole",
    ALTER COLUMN "assignmentSource" TYPE "AssignmentSource" USING "assignmentSource"::"AssignmentSource",
    ALTER COLUMN status TYPE "AssignmentRowStatus" USING status::"AssignmentRowStatus";

-- Update ServiceSession to use enum type
ALTER TABLE "ServiceSession" 
    ALTER COLUMN status TYPE "SessionStatusEnum" USING status::"SessionStatusEnum";

-- Add Booking relation to BookingService
ALTER TABLE "BookingService" 
    ADD CONSTRAINT IF NOT EXISTS "BookingService_bookingId_fkey" 
    FOREIGN KEY ("bookingId") REFERENCES "Booking"(id) ON DELETE CASCADE;

-- Add ArtistProfile relations
ALTER TABLE "ArtistProfile" 
    ADD CONSTRAINT IF NOT EXISTS "ArtistProfile_workSchedules_fkey" 
    FOREIGN KEY ("id") REFERENCES "ArtistProfile"(id); -- self-ref for relation, handled by workSchedules table FK

-- ============================================================
-- END OF D6 MIGRATION
-- ============================================================