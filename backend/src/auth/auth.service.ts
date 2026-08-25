import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { AppError } from "../shared/errors/index.js";
import {
  hashPassword,
  verifyPassword,
  generateOTP,
  generateToken,
  hashToken,
  calculateExpiry,
  calculateRefreshExpiry,
} from "./auth.utils.js";
import {
  createAccessToken,
  createRefreshToken,
  verifyRefreshToken,
  type AccessTokenPayload,
} from "./jwt.utils.js";
import { logAuthEvent, AuditAction } from "./audit.service.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/postgres?schema=public" });
const prisma = new PrismaClient({ adapter });

const OTP_EXPIRY_MINUTES = 5;
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface LoginResult {
  tokens: TokenPair;
  actor: {
    accountId: string;
    actorType: "STAFF" | "ARTIST" | "CLIENT";
    actorId: string;
    role: string;
    accountType: "STAFF" | "ARTIST" | "CLIENT";
  };
}

/**
 * Find account by username (staff)
 */
async function findAccountByUsername(username: string) {
  return prisma.account.findUnique({
    where: { username },
    include: {
      staffProfile: true,
      artistProfile: true,
      clientProfile: true,
    },
  });
}

/**
 * Find account by phone (client/artist)
 */
async function findAccountByPhone(phone: string, accountType: "CLIENT" | "ARTIST") {
  return prisma.account.findFirst({
    where: {
      phone,
      accountType,
    },
    include: {
      staffProfile: true,
      artistProfile: true,
      clientProfile: true,
    },
  });
}

/**
 * Get profile ID and role for an account
 */
function getActorInfo(account: {
  accountType: string;
  role: string;
  staffProfile: { id: string } | null;
  artistProfile: { id: string } | null;
  clientProfile: { id: string } | null;
}): { actorType: "STAFF" | "ARTIST" | "CLIENT"; actorId: string; accountType: "STAFF" | "ARTIST" | "CLIENT"; role: string } {
  switch (account.accountType) {
    case "STAFF":
      if (!account.staffProfile) {
        throw new AppError(500, "PROFILE_MISSING", "Staff profile not found");
      }
      return {
        actorType: "STAFF",
        actorId: account.staffProfile.id,
        accountType: "STAFF",
        role: account.role,
      };
    case "ARTIST":
      if (!account.artistProfile) {
        throw new AppError(500, "PROFILE_MISSING", "Artist profile not found");
      }
      return {
        actorType: "ARTIST",
        actorId: account.artistProfile.id,
        accountType: "ARTIST",
        role: account.role,
      };
    case "CLIENT":
      if (!account.clientProfile) {
        throw new AppError(500, "PROFILE_MISSING", "Client profile not found");
      }
      return {
        actorType: "CLIENT",
        actorId: account.clientProfile.id,
        accountType: "CLIENT",
        role: account.role,
      };
    default:
      throw new AppError(500, "INVALID_ACCOUNT_TYPE", "Unknown account type");
  }
}

/**
 * Create token pair and session
 */
async function createTokenPairAndSession(
  accountId: string,
  actorInfo: { actorType: "STAFF" | "ARTIST" | "CLIENT"; actorId: string; accountType: "STAFF" | "ARTIST" | "CLIENT"; role: string },
  ipAddress?: string,
  userAgent?: string
): Promise<TokenPair> {
  const accessToken = await createAccessToken(
    {
      sub: accountId,
      actorType: actorInfo.actorType,
      actorId: actorInfo.actorId,
      role: actorInfo.role,
      accountType: actorInfo.accountType,
    },
    ACCESS_TOKEN_EXPIRY
  );

  const refreshToken = await createRefreshToken(
    {
      sub: accountId,
      sessionId: "", // Will be set after session creation
    },
    REFRESH_TOKEN_EXPIRY
  );

  // Create session with hashed tokens
  const session = await prisma.session.create({
    data: {
      accountId,
      refreshToken: hashToken(refreshToken),
      accessToken: hashToken(accessToken),
      status: "ACTIVE",
      expiresAt: calculateRefreshExpiry(7),
      ipAddress,
      userAgent,
    },
  });

  // Update refresh token with session ID
  const updatedRefreshToken = await createRefreshToken(
    {
      sub: accountId,
      sessionId: session.id,
    },
    REFRESH_TOKEN_EXPIRY
  );

  // Update session with new refresh token hash
  await prisma.session.update({
    where: { id: session.id },
    data: { refreshToken: hashToken(updatedRefreshToken) },
  });

  return { accessToken, refreshToken: updatedRefreshToken };
}

/**
 * Staff login with username/password
 */
export async function staffLogin(
  username: string,
  password: string,
  ipAddress?: string,
  userAgent?: string
): Promise<LoginResult> {
  const account = await findAccountByUsername(username);

  if (!account) {
    await logAuthEvent({
      action: AuditAction.STAFF_LOGIN_FAILED,
      metadata: { username, reason: "account_not_found" },
      ipAddress,
      userAgent,
      success: false,
      errorCode: "INVALID_CREDENTIALS",
    });
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid username or password.");
  }

  if (account.accountType !== "STAFF") {
    await logAuthEvent({
      accountId: account.id,
      action: AuditAction.STAFF_LOGIN_FAILED,
      metadata: { username, reason: "not_staff_account" },
      ipAddress,
      userAgent,
      success: false,
      errorCode: "INVALID_CREDENTIALS",
    });
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid username or password.");
  }

  if (!account.isActive) {
    await logAuthEvent({
      accountId: account.id,
      action: AuditAction.STAFF_LOGIN_FAILED,
      metadata: { username, reason: "account_disabled" },
      ipAddress,
      userAgent,
      success: false,
      errorCode: "ACCOUNT_DISABLED",
    });
    throw new AppError(403, "ACCOUNT_DISABLED", "Account has been disabled.");
  }

  if (!account.passwordHash) {
    await logAuthEvent({
      accountId: account.id,
      action: AuditAction.STAFF_LOGIN_FAILED,
      metadata: { username, reason: "no_password_set" },
      ipAddress,
      userAgent,
      success: false,
      errorCode: "INVALID_CREDENTIALS",
    });
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid username or password.");
  }

  const isValid = await verifyPassword(password, account.passwordHash);

  if (!isValid) {
    await logAuthEvent({
      accountId: account.id,
      action: AuditAction.STAFF_LOGIN_FAILED,
      metadata: { username, reason: "invalid_password" },
      ipAddress,
      userAgent,
      success: false,
      errorCode: "INVALID_CREDENTIALS",
    });
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid username or password.");
  }

  // Update last login
  await prisma.account.update({
    where: { id: account.id },
    data: { lastLoginAt: new Date() },
  });

  const actorInfo = getActorInfo(account);
  const tokens = await createTokenPairAndSession(account.id, actorInfo, ipAddress, userAgent);

  await logAuthEvent({
    accountId: account.id,
    actorType: "STAFF",
    actorId: actorInfo.actorId,
    action: AuditAction.STAFF_LOGIN,
    metadata: { username },
    ipAddress,
    userAgent,
    success: true,
  });

  return { tokens, actor: { accountId: account.id, ...actorInfo } };
}

/**
 * Send OTP for client login
 */
export async function sendClientOtp(
  phone: string,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  const account = await findAccountByPhone(phone, "CLIENT");

  if (!account) {
    // Don't reveal if account exists - always return success
    await logAuthEvent({
      action: AuditAction.CLIENT_OTP_SENT,
      metadata: { phone, reason: "account_not_found" },
      ipAddress,
      userAgent,
      success: true, // Don't leak account existence
    });
    return;
  }

  if (!account.isActive) {
    await logAuthEvent({
      accountId: account.id,
      action: AuditAction.CLIENT_OTP_SENT,
      metadata: { phone, reason: "account_disabled" },
      ipAddress,
      userAgent,
      success: true, // Don't leak account status
    });
    return;
  }

  // Invalidate existing OTPs for this purpose
  await prisma.oTP.updateMany({
    where: {
      accountId: account.id,
      purpose: "login",
      usedAt: null,
    },
    data: { usedAt: new Date() },
  });

  // Generate new OTP
  const code = generateOTP(6);
  const expiresAt = calculateExpiry(OTP_EXPIRY_MINUTES);

  await prisma.oTP.create({
    data: {
      accountId: account.id,
      code: hashToken(code), // Hash OTP for storage
      purpose: "login",
      expiresAt,
    },
  });

  // TODO: Send OTP via SMS provider
  // For now, log it (in production, use SMS service)
  console.log(`[DEV] OTP for ${phone}: ${code}`);

  await logAuthEvent({
    accountId: account.id,
    actorType: "CLIENT",
    actorId: account.clientProfile?.id,
    action: AuditAction.CLIENT_OTP_SENT,
    metadata: { phone, expiresAt: expiresAt.toISOString() },
    ipAddress,
    userAgent,
    success: true,
  });
}

/**
 * Verify OTP for client login
 */
export async function verifyClientOtp(
  phone: string,
  code: string,
  ipAddress?: string,
  userAgent?: string
): Promise<LoginResult> {
  const account = await findAccountByPhone(phone, "CLIENT");

  if (!account) {
    await logAuthEvent({
      action: AuditAction.CLIENT_OTP_VERIFY_FAILED,
      metadata: { phone, reason: "account_not_found" },
      ipAddress,
      userAgent,
      success: false,
      errorCode: "INVALID_OTP",
    });
    throw new AppError(401, "INVALID_OTP", "Invalid or expired OTP.");
  }

  if (!account.isActive) {
    await logAuthEvent({
      accountId: account.id,
      action: AuditAction.CLIENT_OTP_VERIFY_FAILED,
      metadata: { phone, reason: "account_disabled" },
      ipAddress,
      userAgent,
      success: false,
      errorCode: "ACCOUNT_DISABLED",
    });
    throw new AppError(403, "ACCOUNT_DISABLED", "Account has been disabled.");
  }

  // Find valid OTP
  const otp = await prisma.oTP.findFirst({
    where: {
      accountId: account.id,
      purpose: "login",
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!otp) {
    await logAuthEvent({
      accountId: account.id,
      action: AuditAction.CLIENT_OTP_VERIFY_FAILED,
      metadata: { phone, reason: "otp_not_found_or_expired" },
      ipAddress,
      userAgent,
      success: false,
      errorCode: "INVALID_OTP",
    });
    throw new AppError(401, "INVALID_OTP", "Invalid or expired OTP.");
  }

  // Verify OTP
  const isValid = hashToken(code) === otp.code;

  if (!isValid) {
    await logAuthEvent({
      accountId: account.id,
      action: AuditAction.CLIENT_OTP_VERIFY_FAILED,
      metadata: { phone, reason: "invalid_code" },
      ipAddress,
      userAgent,
      success: false,
      errorCode: "INVALID_OTP",
    });
    throw new AppError(401, "INVALID_OTP", "Invalid or expired OTP.");
  }

  // Mark OTP as used
  await prisma.oTP.update({
    where: { id: otp.id },
    data: { usedAt: new Date() },
  });

  // Update last login
  await prisma.account.update({
    where: { id: account.id },
    data: { lastLoginAt: new Date(), isVerified: true },
  });

  const actorInfo = getActorInfo(account);
  const tokens = await createTokenPairAndSession(account.id, actorInfo, ipAddress, userAgent);

  await logAuthEvent({
    accountId: account.id,
    actorType: "CLIENT",
    actorId: actorInfo.actorId,
    action: AuditAction.CLIENT_OTP_VERIFIED,
    metadata: { phone },
    ipAddress,
    userAgent,
    success: true,
  });

  return { tokens, actor: { accountId: account.id, ...actorInfo } };
}

/**
 * Send OTP for artist login
 */
export async function sendArtistOtp(
  phone: string,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  const account = await findAccountByPhone(phone, "ARTIST");

  if (!account) {
    await logAuthEvent({
      action: AuditAction.ARTIST_OTP_SENT,
      metadata: { phone, reason: "account_not_found" },
      ipAddress,
      userAgent,
      success: true,
    });
    return;
  }

  if (!account.isActive) {
    await logAuthEvent({
      accountId: account.id,
      action: AuditAction.ARTIST_OTP_SENT,
      metadata: { phone, reason: "account_disabled" },
      ipAddress,
      userAgent,
      success: true,
    });
    return;
  }

  // Invalidate existing OTPs
  await prisma.oTP.updateMany({
    where: {
      accountId: account.id,
      purpose: "login",
      usedAt: null,
    },
    data: { usedAt: new Date() },
  });

  const code = generateOTP(6);
  const expiresAt = calculateExpiry(OTP_EXPIRY_MINUTES);

  await prisma.oTP.create({
    data: {
      accountId: account.id,
      code: hashToken(code),
      purpose: "login",
      expiresAt,
    },
  });

  // TODO: Send OTP via SMS provider
  console.log(`[DEV] OTP for ${phone}: ${code}`);

  await logAuthEvent({
    accountId: account.id,
    actorType: "ARTIST",
    actorId: account.artistProfile?.id,
    action: AuditAction.ARTIST_OTP_SENT,
    metadata: { phone, expiresAt: expiresAt.toISOString() },
    ipAddress,
    userAgent,
    success: true,
  });
}

/**
 * Verify OTP for artist login
 */
export async function verifyArtistOtp(
  phone: string,
  code: string,
  ipAddress?: string,
  userAgent?: string
): Promise<LoginResult> {
  const account = await findAccountByPhone(phone, "ARTIST");

  if (!account) {
    await logAuthEvent({
      action: AuditAction.ARTIST_OTP_VERIFY_FAILED,
      metadata: { phone, reason: "account_not_found" },
      ipAddress,
      userAgent,
      success: false,
      errorCode: "INVALID_OTP",
    });
    throw new AppError(401, "INVALID_OTP", "Invalid or expired OTP.");
  }

  if (!account.isActive) {
    await logAuthEvent({
      accountId: account.id,
      action: AuditAction.ARTIST_OTP_VERIFY_FAILED,
      metadata: { phone, reason: "account_disabled" },
      ipAddress,
      userAgent,
      success: false,
      errorCode: "ACCOUNT_DISABLED",
    });
    throw new AppError(403, "ACCOUNT_DISABLED", "Account has been disabled.");
  }

  const otp = await prisma.oTP.findFirst({
    where: {
      accountId: account.id,
      purpose: "login",
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!otp) {
    await logAuthEvent({
      accountId: account.id,
      action: AuditAction.ARTIST_OTP_VERIFY_FAILED,
      metadata: { phone, reason: "otp_not_found_or_expired" },
      ipAddress,
      userAgent,
      success: false,
      errorCode: "INVALID_OTP",
    });
    throw new AppError(401, "INVALID_OTP", "Invalid or expired OTP.");
  }

  const isValid = hashToken(code) === otp.code;

  if (!isValid) {
    await logAuthEvent({
      accountId: account.id,
      action: AuditAction.ARTIST_OTP_VERIFY_FAILED,
      metadata: { phone, reason: "invalid_code" },
      ipAddress,
      userAgent,
      success: false,
      errorCode: "INVALID_OTP",
    });
    throw new AppError(401, "INVALID_OTP", "Invalid or expired OTP.");
  }

  await prisma.oTP.update({
    where: { id: otp.id },
    data: { usedAt: new Date() },
  });

  await prisma.account.update({
    where: { id: account.id },
    data: { lastLoginAt: new Date(), isVerified: true },
  });

  const actorInfo = getActorInfo(account);
  const tokens = await createTokenPairAndSession(account.id, actorInfo, ipAddress, userAgent);

  await logAuthEvent({
    accountId: account.id,
    actorType: "ARTIST",
    actorId: actorInfo.actorId,
    action: AuditAction.ARTIST_OTP_VERIFIED,
    metadata: { phone },
    ipAddress,
    userAgent,
    success: true,
  });

  return { tokens, actor: { accountId: account.id, ...actorInfo } };
}

/**
 * Refresh access token using refresh token
 */
export async function refreshTokens(
  refreshToken: string,
  ipAddress?: string,
  userAgent?: string
): Promise<TokenPair> {
  // Verify refresh token
  const payload = await verifyRefreshToken(refreshToken);

  if (!payload) {
    await logAuthEvent({
      action: AuditAction.TOKEN_REFRESH_FAILED,
      metadata: { reason: "invalid_token" },
      ipAddress,
      userAgent,
      success: false,
      errorCode: "INVALID_TOKEN",
    });
    throw new AppError(401, "INVALID_TOKEN", "Invalid or expired refresh token.");
  }

  // Find session
  const session = await prisma.session.findUnique({
    where: { refreshToken: hashToken(refreshToken) },
    include: {
      account: {
        include: {
          staffProfile: true,
          artistProfile: true,
          clientProfile: true,
        },
      },
    },
  });

  if (!session || session.status !== "ACTIVE") {
    await logAuthEvent({
      accountId: payload.sub,
      action: AuditAction.TOKEN_REFRESH_FAILED,
      metadata: { reason: "session_not_found_or_revoked", sessionId: payload.sessionId },
      ipAddress,
      userAgent,
      success: false,
      errorCode: "SESSION_EXPIRED",
    });
    throw new AppError(401, "SESSION_EXPIRED", "Session has expired or been revoked.");
  }

  if (session.expiresAt < new Date()) {
    await prisma.session.update({
      where: { id: session.id },
      data: { status: "EXPIRED" },
    });
    await logAuthEvent({
      accountId: payload.sub,
      action: AuditAction.TOKEN_REFRESH_FAILED,
      metadata: { reason: "session_expired", sessionId: session.id },
      ipAddress,
      userAgent,
      success: false,
      errorCode: "SESSION_EXPIRED",
    });
    throw new AppError(401, "SESSION_EXPIRED", "Session has expired.");
  }

  if (!session.account.isActive) {
    await logAuthEvent({
      accountId: session.account.id,
      action: AuditAction.TOKEN_REFRESH_FAILED,
      metadata: { reason: "account_disabled" },
      ipAddress,
      userAgent,
      success: false,
      errorCode: "ACCOUNT_DISABLED",
    });
    throw new AppError(403, "ACCOUNT_DISABLED", "Account has been disabled.");
  }

  // Get actor info
  const account = session.account;
  const actorInfo = getActorInfo({
    accountType: account.accountType,
    role: account.role,
    staffProfile: account.staffProfile ? { id: account.staffProfile.id } : null,
    artistProfile: account.artistProfile ? { id: account.artistProfile.id } : null,
    clientProfile: account.clientProfile ? { id: account.clientProfile.id } : null,
  });

  // Create new token pair (rotate tokens)
  const newAccessToken = await createAccessToken(
    {
      sub: account.id,
      actorType: actorInfo.actorType,
      actorId: actorInfo.actorId,
      role: actorInfo.role,
      accountType: actorInfo.accountType,
    },
    ACCESS_TOKEN_EXPIRY
  );

  const newRefreshToken = await createRefreshToken(
    {
      sub: account.id,
      sessionId: session.id,
    },
    REFRESH_TOKEN_EXPIRY
  );

  // Update session with new tokens
  await prisma.session.update({
    where: { id: session.id },
    data: {
      refreshToken: hashToken(newRefreshToken),
      accessToken: hashToken(newAccessToken),
      expiresAt: calculateRefreshExpiry(7),
    },
  });

  await logAuthEvent({
    accountId: account.id,
    actorType: actorInfo.actorType,
    actorId: actorInfo.actorId,
    action: AuditAction.TOKEN_REFRESH,
    metadata: { sessionId: session.id },
    ipAddress,
    userAgent,
    success: true,
  });

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

/**
 * Logout - revoke session
 */
export async function logout(
  refreshToken: string,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { refreshToken: hashToken(refreshToken) },
    include: {
      account: {
        include: {
          staffProfile: true,
          artistProfile: true,
          clientProfile: true,
        },
      },
    },
  });

  if (!session) {
    await logAuthEvent({
      action: AuditAction.LOGOUT_FAILED,
      metadata: { reason: "session_not_found" },
      ipAddress,
      userAgent,
      success: false,
      errorCode: "SESSION_NOT_FOUND",
    });
    throw new AppError(404, "SESSION_NOT_FOUND", "Session not found.");
  }

  await prisma.session.update({
    where: { id: session.id },
    data: {
      status: "REVOKED",
      revokedAt: new Date(),
    },
  });

  const account = session.account;
  let actorInfo: { actorType: "STAFF" | "ARTIST" | "CLIENT"; actorId: string } | null = null;

  if (account.accountType === "STAFF" && account.staffProfile) {
    actorInfo = { actorType: "STAFF", actorId: account.staffProfile.id };
  } else if (account.accountType === "ARTIST" && account.artistProfile) {
    actorInfo = { actorType: "ARTIST", actorId: account.artistProfile.id };
  } else if (account.accountType === "CLIENT" && account.clientProfile) {
    actorInfo = { actorType: "CLIENT", actorId: account.clientProfile.id };
  }

  await logAuthEvent({
    accountId: account.id,
    actorType: actorInfo?.actorType,
    actorId: actorInfo?.actorId,
    action: AuditAction.LOGOUT,
    metadata: { sessionId: session.id },
    ipAddress,
    userAgent,
    success: true,
  });
}