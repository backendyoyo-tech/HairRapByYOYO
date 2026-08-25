import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma } from "./generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:***@localhost:5432/postgres?schema=public" });
const prisma = new PrismaClient({ adapter });

export interface AuditLogEntry {
  accountId?: string;
  actorType?: "STAFF" | "ARTIST" | "CLIENT" | "SYSTEM";
  actorId?: string;
  action: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
  success?: boolean;
  errorCode?: string;
}

/**
 * Log an authentication/audit event
 * Never logs OTP codes, tokens, or passwords
 */
export async function logAuthEvent(entry: AuditLogEntry): Promise<void> {
  try {
    // Sanitize metadata to ensure no secrets are logged
    const sanitizedMetadata = entry.metadata
      ? sanitizeMetadata(entry.metadata)
      : undefined;

    await prisma.auditLog.create({
      data: {
        accountId: entry.accountId,
        actorType: entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        metadata: sanitizedMetadata,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        success: entry.success ?? true,
        errorCode: entry.errorCode,
      },
    });
  } catch (error) {
    // Fail silently - audit logging should never break the main flow
    console.error("Failed to write audit log:", error);
  }
}

/**
 * Remove sensitive fields from metadata before logging
 */
function sanitizeMetadata(
  metadata: Prisma.InputJsonValue
): Prisma.InputJsonValue {
  const sensitiveKeys = [
    "password",
    "passwordHash",
    "otp",
    "code",
    "token",
    "accessToken",
    "refreshToken",
    "secret",
    "authorization",
  ];

  if (metadata === null || metadata === undefined) {
    return metadata;
  }

  if (Array.isArray(metadata)) {
    return metadata.map((item) => sanitizeMetadata(item));
  }

  if (typeof metadata === "object") {
    const sanitized: Record<string, Prisma.InputJsonValue> = {};

    for (const [key, value] of Object.entries(metadata)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
        sanitized[key] = "[REDACTED]";
      } else if (typeof value === "object" && value !== null) {
        sanitized[key] = sanitizeMetadata(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  return metadata;
}

/**
 * Predefined audit actions for consistency
 */
export const AuditAction = {
  // Auth events
  STAFF_LOGIN: "STAFF_LOGIN",
  STAFF_LOGIN_FAILED: "STAFF_LOGIN_FAILED",
  CLIENT_OTP_SENT: "CLIENT_OTP_SENT",
  CLIENT_OTP_VERIFIED: "CLIENT_OTP_VERIFIED",
  CLIENT_OTP_VERIFY_FAILED: "CLIENT_OTP_VERIFY_FAILED",
  ARTIST_OTP_SENT: "ARTIST_OTP_SENT",
  ARTIST_OTP_VERIFIED: "ARTIST_OTP_VERIFIED",
  ARTIST_OTP_VERIFY_FAILED: "ARTIST_OTP_VERIFY_FAILED",
  TOKEN_REFRESH: "TOKEN_REFRESH",
  TOKEN_REFRESH_FAILED: "TOKEN_REFRESH_FAILED",
  LOGOUT: "LOGOUT",
  LOGOUT_FAILED: "LOGOUT_FAILED",

  // Account events
  ACCOUNT_CREATED: "ACCOUNT_CREATED",
  ACCOUNT_DISABLED: "ACCOUNT_DISABLED",
  ACCOUNT_ENABLED: "ACCOUNT_ENABLED",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  ROLE_CHANGED: "ROLE_CHANGED",

  // Security events
  SUSPICIOUS_ACTIVITY: "SUSPICIOUS_ACTIVITY",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
} as const;