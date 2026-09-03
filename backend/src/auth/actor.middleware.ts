import type { NextFunction, Request, Response } from "express";
// src/auth/actor.middleware.ts
import { PrismaClient } from "../generated/prisma/client.js"
import { PrismaPg } from "@prisma/adapter-pg";
import { AppError } from "../shared/errors/index.js";
import { verifyAccessToken, type AccessTokenPayload } from "./jwt.utils.js";
import { hashToken } from "./auth.utils.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/postgres?schema=public" });
const prisma = new PrismaClient({ adapter });

declare global {
  namespace Express {
    interface Request {
      actor?: ActorContext;
    }
  }
}

export interface ActorContext {
  accountId: string;
  actorType: "STAFF" | "ARTIST" | "CLIENT";
  actorId: string; // profile ID
  role: string;
  accountType: "STAFF" | "ARTIST" | "CLIENT";
  sessionId: string;
}

/**
 * Middleware to extract and validate actor context from access token
 * Must be placed after requestContextMiddleware
 */
export async function actorContextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      // No token - continue without actor (public endpoints)
      next();
      return;
    }

    const token = authHeader.slice(7); // Remove "Bearer "
    const payload = await verifyAccessToken(token);

    if (!payload) {
      next(
        new AppError(
          401,
          "INVALID_TOKEN",
          "Access token is invalid or expired."
        )
      );
      return;
    }

    // Verify session exists and is active
    const session = await prisma.session.findUnique({
      where: { accessToken: hashToken(token) },
      include: { account: true },
    });

    if (!session || session.status !== "ACTIVE") {
      next(
        new AppError(
          401,
          "SESSION_EXPIRED",
          "Session has expired or been revoked."
        )
      );
      return;
    }

    if (session.expiresAt < new Date()) {
      next(
        new AppError(
          401,
          "SESSION_EXPIRED",
          "Session has expired."
        )
      );
      return;
    }

    // Verify account is still active
    if (!session.account.isActive) {
      next(
        new AppError(
          403,
          "ACCOUNT_DISABLED",
          "Account has been disabled."
        )
      );
      return;
    }

    // Build actor context
    req.actor = {
      accountId: payload.sub,
      actorType: payload.actorType,
      actorId: payload.actorId,
      role: payload.role,
      accountType: payload.accountType,
      sessionId: session.id,
    };

    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(
        new AppError(
          500,
          "ACTOR_CONTEXT_ERROR",
          "Failed to resolve actor context."
        )
      );
    }
  }
}

/**
 * Middleware to require authentication (must have valid actor)
 */
export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!req.actor) {
    next(
      new AppError(
        401,
        "UNAUTHENTICATED",
        "Authentication required."
      )
    );
    return;
  }
  next();
}

/**
 * Middleware to require specific actor type(s)
 */
export function requireActorType(...allowedTypes: ActorContext["actorType"][]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.actor) {
      next(
        new AppError(
          401,
          "UNAUTHENTICATED",
          "Authentication required."
        )
      );
      return;
    }

    if (!allowedTypes.includes(req.actor.actorType)) {
      next(
        new AppError(
          403,
          "ACTOR_TYPE_MISMATCH",
          `This endpoint requires actor type: ${allowedTypes.join(", ")}`
        )
      );
      return;
    }

    next();
  };
}

/**
 * Middleware to require specific role(s)
 */
export function requireRole(...allowedRoles: string[]) {
  // Support both requireRole('CLIENT', 'ARTIST') and requireRole(['CLIENT', 'ARTIST'])
  const roles = allowedRoles.length === 1 && Array.isArray(allowedRoles[0]) ? allowedRoles[0] : allowedRoles;
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.actor) {
      next(
        new AppError(
          401,
          "UNAUTHENTICATED",
          "Authentication required."
        )
      );
      return;
    }

    if (!roles.includes(req.actor.role)) {
      next(
        new AppError(
          403,
          "INSUFFICIENT_ROLE",
          `This endpoint requires role: ${roles.join(", ")}`
        )
      );
      return;
    }

    next();
  };
}

/**
 * Middleware to require specific account type(s)
 */
export function requireAccountType(...allowedTypes: ActorContext["accountType"][]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.actor) {
      next(
        new AppError(
          401,
          "UNAUTHENTICATED",
          "Authentication required."
        )
      );
      return;
    }

    if (!allowedTypes.includes(req.actor.accountType)) {
      next(
        new AppError(
          403,
          "ACCOUNT_TYPE_MISMATCH",
          `This endpoint requires account type: ${allowedTypes.join(", ")}`
        )
      );
      return;
    }

    next();
  };
}