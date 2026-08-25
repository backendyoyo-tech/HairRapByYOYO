import type { Request, Response } from "express";
import { successResponse } from "../shared/responses/index.js";
import {
  staffLogin,
  sendClientOtp,
  verifyClientOtp,
  sendArtistOtp,
  verifyArtistOtp,
  refreshTokens,
  logout,
} from "./auth.service.js";

/**
 * POST /api/v1/auth/staff/login
 */
export async function staffLoginController(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body;
  const ipAddress = req.ip;
  const userAgent = req.headers["user-agent"];

  const result = await staffLogin(email, password, ipAddress, userAgent);

  res.status(200).json(
    successResponse(
      {
        access_token: result.tokens.accessToken,
        refresh_token: result.tokens.refreshToken,
        token_type: "Bearer",
        expires_in: 900, // 15 minutes
        actor: result.actor,
      },
      req.requestContext.requestId
    )
  );
}

/**
 * POST /api/v1/auth/client/otp/send
 */
export async function sendClientOtpController(req: Request, res: Response): Promise<void> {
  const { phone } = req.body;
  const ipAddress = req.ip;
  const userAgent = req.headers["user-agent"];

  await sendClientOtp(phone, ipAddress, userAgent);

  // Always return success to prevent account enumeration
  res.status(200).json(
    successResponse(
      {
        message: "If the phone number is registered, an OTP has been sent.",
      },
      req.requestContext.requestId
    )
  );
}

/**
 * POST /api/v1/auth/client/otp/verify
 */
export async function verifyClientOtpController(req: Request, res: Response): Promise<void> {
  const { phone, code } = req.body;
  const ipAddress = req.ip;
  const userAgent = req.headers["user-agent"];

  const result = await verifyClientOtp(phone, code, ipAddress, userAgent);

  res.status(200).json(
    successResponse(
      {
        access_token: result.tokens.accessToken,
        refresh_token: result.tokens.refreshToken,
        token_type: "Bearer",
        expires_in: 900,
        actor: result.actor,
      },
      req.requestContext.requestId
    )
  );
}

/**
 * POST /api/v1/auth/artist/otp/send
 */
export async function sendArtistOtpController(req: Request, res: Response): Promise<void> {
  const { phone } = req.body;
  const ipAddress = req.ip;
  const userAgent = req.headers["user-agent"];

  await sendArtistOtp(phone, ipAddress, userAgent);

  res.status(200).json(
    successResponse(
      {
        message: "If the phone number is registered, an OTP has been sent.",
      },
      req.requestContext.requestId
    )
  );
}

/**
 * POST /api/v1/auth/artist/otp/verify
 */
export async function verifyArtistOtpController(req: Request, res: Response): Promise<void> {
  const { phone, code } = req.body;
  const ipAddress = req.ip;
  const userAgent = req.headers["user-agent"];

  const result = await verifyArtistOtp(phone, code, ipAddress, userAgent);

  res.status(200).json(
    successResponse(
      {
        access_token: result.tokens.accessToken,
        refresh_token: result.tokens.refreshToken,
        token_type: "Bearer",
        expires_in: 900,
        actor: result.actor,
      },
      req.requestContext.requestId
    )
  );
}

/**
 * POST /api/v1/auth/refresh
 */
export async function refreshController(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body;
  const ipAddress = req.ip;
  const userAgent = req.headers["user-agent"];

  const tokens = await refreshTokens(refreshToken, ipAddress, userAgent);

  res.status(200).json(
    successResponse(
      {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_type: "Bearer",
        expires_in: 900,
      },
      req.requestContext.requestId
    )
  );
}

/**
 * POST /api/v1/auth/logout
 */
export async function logoutController(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body;
  const ipAddress = req.ip;
  const userAgent = req.headers["user-agent"];

  await logout(refreshToken, ipAddress, userAgent);

  res.status(200).json(
    successResponse(
      {
        message: "Logged out successfully.",
      },
      req.requestContext.requestId
    )
  );
}