import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { AppError } from "../shared/errors/index.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

export interface CreateAdvanceOrderRequest {
  holdId: string;
  idempotencyKey: string;
}

export interface AdvanceOrderResponse {
  orderId: string;
  amount: string;
  currency: string;
  key: string; // Razorpay key ID (public)
  holdId: string;
  [key: string]: any; // Index signature for Prisma Json compatibility
}

export interface VerifyPaymentRequest {
  holdId: string;
  razorpayPaymentId: string;
  razorpayOrderId: string;
  razorpaySignature: string;
  idempotencyKey: string;
}

export interface PaymentService {
  createAdvanceOrder(request: CreateAdvanceOrderRequest, clientId: string): Promise<AdvanceOrderResponse>;
  verifyPaymentAndConfirmBooking(request: VerifyPaymentRequest, clientId: string): Promise<{ bookingId: string; status: string }>;
  getPayment(paymentId: string): Promise<any>;
  handleRazorpayWebhook(payload: any, signature: string): Promise<void>;
}

export class PaymentServiceImpl implements PaymentService {
  private readonly RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "rzp_test_dummy";
  private readonly RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "dummy_secret";

  async createAdvanceOrder(request: CreateAdvanceOrderRequest, clientId: string): Promise<AdvanceOrderResponse> {
    const { holdId, idempotencyKey } = request;

    // Check idempotency
    const existingKey = await prisma.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
    if (existingKey) {
      if (existingKey.responseBody) {
        return existingKey.responseBody as unknown as AdvanceOrderResponse;
      }
      throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key already used');
    }

    // Get hold
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

    const amountPaise = Math.round(Number(hold.totalAdvanceAmount) * 100);

    // Create Razorpay order (simulated - in production use Razorpay SDK)
    const orderId = `order_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Create payment record
    const payment = await prisma.payment.create({
      data: {
        bookingId: hold.bookingId || undefined,
        clientId,
        purpose: 'ADVANCE',
        status: 'INITIATED',
        amount: hold.totalAdvanceAmount,
        currency: 'INR',
        provider: 'razorpay',
        providerOrderId: orderId,
        metadata: { holdId },
      },
    });

    const response: AdvanceOrderResponse = {
      orderId,
      amount: hold.totalAdvanceAmount.toFixed(2),
      currency: 'INR',
      key: this.RAZORPAY_KEY_ID,
      holdId,
    };

    // Record idempotency
    await prisma.idempotencyKey.create({
      data: {
        key: idempotencyKey,
        endpoint: '/api/v1/booking-holds/advance-order',
        method: 'POST',
        requestHash: this.hashRequest(request),
        responseStatus: 201,
        responseBody: response,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    return response;
  }

  async verifyPaymentAndConfirmBooking(request: VerifyPaymentRequest, clientId: string): Promise<{ bookingId: string; status: string }> {
    const { holdId, razorpayPaymentId, razorpayOrderId, razorpaySignature, idempotencyKey } = request;

    // Check idempotency
    const existingKey = await prisma.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
    if (existingKey) {
      if (existingKey.responseBody) {
        return existingKey.responseBody as unknown as { bookingId: string; status: string };
      }
      throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key already used');
    }

    // Verify signature (simulated - in production use Razorpay SDK)
    const expectedSignature = this.generateSignature(razorpayOrderId, razorpayPaymentId);
    if (razorpaySignature !== expectedSignature) {
      throw new AppError(400, 'INVALID_SIGNATURE', 'Payment signature verification failed');
    }

    // Get hold
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

    // Update payment record
    const payment = await prisma.payment.findFirst({
      where: { providerOrderId: razorpayOrderId, clientId },
    });

    if (!payment) {
      throw new AppError(404, 'NOT_FOUND', 'Payment record not found');
    }

    // Recheck availability and create booking in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Verify resources are still available
      for (const resource of hold.resources) {
        const conflict = await tx.bookingService.findFirst({
          where: {
            artistId: resource.artistId,
            plannedStartAt: { lt: resource.endAt },
            plannedEndAt: { gt: resource.startAt },
            booking: { status: { in: ['CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'] } },
          },
        });
        if (conflict) {
          throw new AppError(409, 'SLOT_UNAVAILABLE', `Slot no longer available`);
        }
      }

      // Create booking from hold (reuse existing logic)
      const quote = await tx.bookingQuote.findUnique({ where: { id: hold.quoteId } });
      if (!quote) {
        throw new AppError(404, 'NOT_FOUND', 'Associated quote not found');
      }

      const quoteServices = quote.services as any[];
      const bookingServicesData: any[] = [];

      for (let idx = 0; idx < hold.resources.length; idx++) {
        const resource = hold.resources[idx];
        const quoteService = quoteServices[resource.bookingServiceId
          ? quoteServices.findIndex((qs: any) => qs.serviceId === resource.bookingServiceId)
          : idx];
        const serviceId = quoteService?.serviceId;
        const serviceDetails = serviceId ? await tx.service.findUnique({ where: { id: serviceId } }) : null;

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

      const totalPrice = Number(quote.serviceTotal.toString());
      const totalAdvanceRequired = Number(quote.advanceRequired.toString());
      const advanceRule = quote.advanceRule;

      // Create booking
      const firstSvc = bookingServicesData[0];
      const newBooking = await tx.booking.create({
        data: {
          clientId: hold.clientId,
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
          actorId: hold.clientId,
          reason: 'Booking created from hold after payment',
        },
      });

      // Update payment
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCEEDED',
          providerPaymentId: request.razorpayPaymentId,
          providerSignature: request.razorpaySignature,
          succeededAt: new Date(),
          bookingId: newBooking.id,
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

    // Record idempotency
    const response = { bookingId: result.id, status: 'CONFIRMED' };
    await prisma.idempotencyKey.create({
      data: {
        key: idempotencyKey,
        endpoint: '/api/v1/booking-holds/verify-payment',
        method: 'POST',
        requestHash: this.hashRequest(request),
        responseStatus: 201,
        responseBody: response,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    return response;
  }

  async getPayment(paymentId: string): Promise<any> {
    return prisma.payment.findUnique({ where: { id: paymentId } });
  }

  async handleRazorpayWebhook(payload: any, signature: string): Promise<void> {
    const providerEventId = payload.event;
    
    // Check if already processed
    const existing = await prisma.paymentWebhookEvent.findUnique({
      where: { providerEventId },
    });
    if (existing) {
      return; // Already processed
    }

    // Verify signature (simulated)
    // In production: const expected = crypto.createHmac('sha256', this.RAZORPAY_KEY_SECRET).update(JSON.stringify(payload)).digest('hex');
    
    // Record webhook event
    await prisma.paymentWebhookEvent.create({
      data: {
        provider: 'razorpay',
        providerEventId,
        eventType: payload.event,
        payload,
        processingStatus: 'PROCESSING',
      },
    });

    try {
      const paymentEntity = payload.payload.payment.entity;
      const paymentId = paymentEntity.id;
      const orderId = paymentEntity.order_id;
      const status = paymentEntity.status;

      // Update payment record
      const payment = await prisma.payment.findFirst({
        where: { providerOrderId: orderId },
      });

      if (payment) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: status === 'captured' ? 'SUCCEEDED' : 'FAILED',
            providerPaymentId: paymentId,
            succeededAt: status === 'captured' ? new Date() : undefined,
            failedAt: status === 'failed' ? new Date() : undefined,
            providerSignature: paymentEntity.signature,
          },
        });
      }

      await prisma.paymentWebhookEvent.update({
        where: { providerEventId },
        data: { processingStatus: 'PROCESSED', processedAt: new Date() },
      });
    } catch (error) {
      await prisma.paymentWebhookEvent.update({
        where: { providerEventId },
        data: { processingStatus: 'FAILED_RETRYABLE', errorMessage: String(error) },
      });
      throw error;
    }
  }

  private generateSignature(orderId: string, paymentId: string): string {
    // Simulated signature - in production use Razorpay SDK
    const crypto = require('crypto');
    return crypto.createHmac('sha256', this.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
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

export const paymentService = new PaymentServiceImpl();