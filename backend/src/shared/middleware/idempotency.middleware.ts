import type { NextFunction, Request, Response } from "express";
import { PrismaClient, Prisma } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { AppError } from "../../shared/errors/index.js";
import { hashRequest } from "./idempotency.utils.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

interface IdempotencyRequest extends Request {
  idempotencyKey?: string;
  idempotencyRecord?: {
    key: string;
    responseBody: any;
    responseStatus: number;
  };
}

/**
 * Idempotency middleware
 * - Reads Idempotency-Key header
 * - Checks database for existing key
 * - If found and completed, returns cached response
 * - If found but not completed, returns 409 conflict
 * - If not found, stores key and continues
 * - On response, stores response if successful
 */
export async function idempotencyMiddleware(
  req: IdempotencyRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Only apply to mutating methods
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      next();
      return;
    }

    // Read idempotency key from header
    const idempotencyKey = req.headers['idempotency-key'] as string;
    if (!idempotencyKey) {
      next(new AppError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required for this endpoint'));
      return;
    }

    if (idempotencyKey.length > 255) {
      next(new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency key too long (max 255 chars)'));
      return;
    }

    // Store on request for later use
    req.idempotencyKey = idempotencyKey;

    // Check for existing key in database
    const existing = await prisma.idempotencyKey.findUnique({
      where: { key: idempotencyKey },
    });

    if (existing) {
      // Key exists - check if expired
      if (existing.expiresAt < new Date()) {
        // Expired - delete and allow new request
        await prisma.idempotencyKey.delete({ where: { key: idempotencyKey } });
      } else if (existing.responseBody) {
        // Completed request - return cached response
        res.setHeader('Idempotency-Key', idempotencyKey);
        res.setHeader('X-Idempotency-Replay', 'true');
        res.status(existing.responseStatus || 200).json(existing.responseBody);
        return;
      } else {
        // In-progress request - conflict
        next(new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Request with this idempotency key is already being processed'));
        return;
      }
    }

    // Create placeholder record
    const requestHash = hashRequest({
      method: req.method,
      path: req.path,
      body: req.body,
      query: req.query,
    });

    await prisma.idempotencyKey.create({
      data: {
        key: idempotencyKey,
        endpoint: req.path,
        method: req.method,
        requestHash,
        responseStatus: 0,
        responseBody: Prisma.JsonNull,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
    });

    // Hook into response to store result
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      // Only store successful responses (2xx)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        prisma.idempotencyKey.update({
          where: { key: idempotencyKey },
          data: {
            responseStatus: res.statusCode,
            responseBody: body,
          },
        }).catch(() => {}); // Fire and forget
      }
      return originalJson(body);
    };

    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError(500, 'IDEMPOTENCY_ERROR', 'Failed to process idempotency key'));
    }
  }
}