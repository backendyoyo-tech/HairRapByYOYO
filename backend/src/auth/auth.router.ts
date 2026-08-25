import { Router } from "express";
import { validate } from "../middleware/validation.middleware.js";
import { actorContextMiddleware, requireAuth } from "./actor.middleware.js";
import {
  staffLoginController,
  sendClientOtpController,
  verifyClientOtpController,
  sendArtistOtpController,
  verifyArtistOtpController,
  refreshController,
  logoutController,
} from "./auth.controller.js";
import {
  staffLoginSchema,
  staffPasswordResetRequestSchema,
  staffPasswordResetConfirmSchema,
  clientOtpRequestSchema,
  clientOtpVerifySchema,
  artistOtpRequestSchema,
  artistOtpVerifySchema,
  refreshTokenSchema,
  logoutSchema,
} from "./auth.validation.js";

const router = Router();

// Apply actor context middleware to all auth routes
router.use(actorContextMiddleware);

// ===== PUBLIC AUTH ENDPOINTS =====

// Staff authentication (username/password)
router.post(
  "/staff/login",
  validate(staffLoginSchema),
  staffLoginController
);

// Staff password reset (email-based)
router.post(
  "/staff/password-reset/request",
  validate(staffPasswordResetRequestSchema),
  async (req, res) => {
    // TODO: Implement staff password reset request
    res.status(501).json({ error: { code: "NOT_IMPLEMENTED", message: "Not yet implemented" } });
  }
);

router.post(
  "/staff/password-reset/confirm",
  validate(staffPasswordResetConfirmSchema),
  async (req, res) => {
    // TODO: Implement staff password reset confirm
    res.status(501).json({ error: { code: "NOT_IMPLEMENTED", message: "Not yet implemented" } });
  }
);

// Client OTP authentication
router.post(
  "/client/otp/request",
  validate(clientOtpRequestSchema),
  sendClientOtpController
);

router.post(
  "/client/otp/verify",
  validate(clientOtpVerifySchema),
  verifyClientOtpController
);

// Artist OTP authentication
router.post(
  "/artist/otp/request",
  validate(artistOtpRequestSchema),
  sendArtistOtpController
);

router.post(
  "/artist/otp/verify",
  validate(artistOtpVerifySchema),
  verifyArtistOtpController
);

// ===== AUTHENTICATED ENDPOINTS =====

// Token refresh (uses refresh token from body)
router.post(
  "/refresh",
  validate(refreshTokenSchema),
  refreshController
);

// Protected endpoints requiring valid access token
router.post(
  "/logout",
  requireAuth,
  validate(logoutSchema),
  logoutController
);

// GET /me - returns current actor info
router.get(
  "/me",
  requireAuth,
  async (req, res) => {
    // TODO: Implement me endpoint
    res.status(501).json({ error: { code: "NOT_IMPLEMENTED", message: "Not yet implemented" } });
  }
);

export default router;