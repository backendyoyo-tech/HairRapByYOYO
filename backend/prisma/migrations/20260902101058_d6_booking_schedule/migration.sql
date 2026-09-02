-- DropForeignKey
ALTER TABLE "ArtistScheduleException" DROP CONSTRAINT "ArtistScheduleException_artistId_fkey";

-- DropForeignKey
ALTER TABLE "ArtistWorkSchedule" DROP CONSTRAINT "ArtistWorkSchedule_artistId_fkey";

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_clientId_fkey";

-- DropForeignKey
ALTER TABLE "BookingHold" DROP CONSTRAINT "BookingHold_bookingId_fkey";

-- DropForeignKey
ALTER TABLE "BookingHold" DROP CONSTRAINT "BookingHold_clientId_fkey";

-- DropForeignKey
ALTER TABLE "BookingHoldResource" DROP CONSTRAINT "BookingHoldResource_artistId_fkey";

-- DropForeignKey
ALTER TABLE "BookingHoldResource" DROP CONSTRAINT "BookingHoldResource_holdId_fkey";

-- DropForeignKey
ALTER TABLE "BookingRescheduleHistory" DROP CONSTRAINT "BookingRescheduleHistory_bookingId_fkey";

-- DropForeignKey
ALTER TABLE "BookingService" DROP CONSTRAINT "BookingService_bookingId_fkey";

-- DropForeignKey
ALTER TABLE "BookingStatusHistory" DROP CONSTRAINT "BookingStatusHistory_bookingId_fkey";

-- AlterTable
ALTER TABLE "ArtistScheduleException" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "exceptionDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "startTime" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "endTime" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ArtistWorkSchedule" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "startTime" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "endTime" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Booking" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "confirmedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "checkedInAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "cancelledAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BookingHold" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "expiresAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "consumedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "releasedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BookingHoldResource" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "startAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "endAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BookingQuote" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "expiresAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BookingRescheduleHistory" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BookingStatusHistory" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "IdempotencyKey" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "expiresAt" SET DATA TYPE TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ArtistProfile_isAvailable_idx" ON "ArtistProfile"("isAvailable");

-- AddForeignKey
ALTER TABLE "BookingService" ADD CONSTRAINT "BookingService_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingServiceAssignment" ADD CONSTRAINT "BookingServiceAssignment_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "ArtistProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingHold" ADD CONSTRAINT "BookingHold_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingHold" ADD CONSTRAINT "BookingHold_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingHoldResource" ADD CONSTRAINT "BookingHoldResource_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "BookingHold"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingStatusHistory" ADD CONSTRAINT "BookingStatusHistory_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingRescheduleHistory" ADD CONSTRAINT "BookingRescheduleHistory_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistWorkSchedule" ADD CONSTRAINT "ArtistWorkSchedule_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "ArtistProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistScheduleException" ADD CONSTRAINT "ArtistScheduleException_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "ArtistProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "ArtistScheduleException_artistId_exceptionDate_startTime_endTim" RENAME TO "ArtistScheduleException_artistId_exceptionDate_startTime_en_key";
