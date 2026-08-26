import { randomBytes, timingSafeEqual, pbkdf2, createHash } from "node:crypto";
/**
 * Hash a password using PBKDF2 with SHA-256
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const iterations = 100000;
  const keyLength = 32;
  const hash = await new Promise<Buffer>((resolve, reject) => {
    pbkdf2(
      password,
      salt,
      iterations,
      keyLength,
      "sha256",
      (err: Error | null, derivedKey: Buffer) => {
        if (err) reject(err);
        else resolve(derivedKey);
      }
    );
  });
  // Format: iterations:salt:hash (all base64)
  return `${iterations}:${salt.toString("base64")}:${hash.toString("base64")}`;
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  try {
    const [iterationsStr, saltB64, hashB64] = storedHash.split(":");
    if (!iterationsStr || !saltB64 || !hashB64) {
      return false;
    }
    const iterations = parseInt(iterationsStr, 10);
    const salt = Buffer.from(saltB64, "base64");
    const expectedHash = Buffer.from(hashB64, "base64");

    const hash = await new Promise<Buffer>((resolve, reject) => {
      pbkdf2(
        password,
        salt,
        iterations,
        expectedHash.length,
        "sha256",
        (err: Error | null, derivedKey: Buffer) => {
          if (err) reject(err);
          else resolve(derivedKey);
        }
      );
    });

    // Use timing-safe comparison
    return timingSafeEqual(hash, expectedHash);
  } catch {
    return false;
  }
}

/**
 * Generate a secure random OTP code
 */
export function generateOTP(length: number = 6): string {
  const digits = "0123456789";
  let otp = "";
  const randomValues = randomBytes(length);
  for (let i = 0; i < length; i++) {
    otp += digits[randomValues[i] % 10];
  }
  return otp;
}

/**
 * Generate a secure random token
 */
export function generateToken(length: number = 32): string {
  return randomBytes(length).toString("base64url");
}

/**
 * Hash a token for storage (using SHA-256)
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Calculate token expiry date
 */
export function calculateExpiry(
  minutes: number = 15
): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

/**
 * Calculate refresh token expiry date (default 7 days)
 */
export function calculateRefreshExpiry(
  days: number = 7
): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}