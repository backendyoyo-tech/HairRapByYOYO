import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const ACCESS_TOKEN_SECRET = new TextEncoder().encode(
  process.env.ACCESS_TOKEN_SECRET ?? "dev-access-secret-change-in-production"
);

const REFRESH_TOKEN_SECRET = new TextEncoder().encode(
  process.env.REFRESH_TOKEN_SECRET ?? "dev-refresh-secret-change-in-production"
);

export interface AccessTokenPayload extends JWTPayload {
  sub: string; // account ID
  actorType: "STAFF" | "ARTIST" | "CLIENT";
  actorId: string; // profile ID (staffProfileId, artistProfileId, or clientProfileId)
  role: string;
  accountType: "STAFF" | "ARTIST" | "CLIENT";
}

export interface RefreshTokenPayload extends JWTPayload {
  sub: string; // account ID
  sessionId: string;
}

/**
 * Create an access token (short-lived, e.g., 15 minutes)
 */
export async function createAccessToken(
  payload: Omit<AccessTokenPayload, "iat" | "exp" | "jti">,
  expiresIn: string = "15m"
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .setJti(crypto.randomUUID())
    .sign(ACCESS_TOKEN_SECRET);
}

/**
 * Create a refresh token (long-lived, e.g., 7 days)
 */
export async function createRefreshToken(
  payload: Omit<RefreshTokenPayload, "iat" | "exp" | "jti">,
  expiresIn: string = "7d"
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .setJti(crypto.randomUUID())
    .sign(REFRESH_TOKEN_SECRET);
}

/**
 * Verify an access token
 */
export async function verifyAccessToken(
  token: string
): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, ACCESS_TOKEN_SECRET);
    return payload as AccessTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Verify a refresh token
 */
export async function verifyRefreshToken(
  token: string
): Promise<RefreshTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, REFRESH_TOKEN_SECRET);
    return payload as RefreshTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Decode a token without verification (for debugging/logging)
 */
export function decodeToken(token: string): JWTPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8")
    );
    return payload;
  } catch {
    return null;
  }
}