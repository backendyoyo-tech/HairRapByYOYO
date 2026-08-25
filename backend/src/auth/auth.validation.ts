import { z } from "zod";
import type { ValidationSchemas } from "../shared/contracts/index.js";

/**
 * Staff login: email + password
 */
export const staffLoginSchema: ValidationSchemas = {
  body: z.object({
    email: z.string().email("Invalid email format"),
    password: z.string().min(8, "Password must be at least 8 characters"),
  }),
};

/**
 * Staff password reset request: email
 */
export const staffPasswordResetRequestSchema: ValidationSchemas = {
  body: z.object({
    email: z.string().email("Invalid email format"),
  }),
};

/**
 * Staff password reset confirm: email + code + new password
 */
export const staffPasswordResetConfirmSchema: ValidationSchemas = {
  body: z.object({
    email: z.string().email("Invalid email format"),
    code: z.string().length(6, "OTP code must be 6 digits"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
  }),
};

/**
 * Client OTP request: phone
 */
export const clientOtpRequestSchema: ValidationSchemas = {
  body: z.object({
    phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone number format (E.164)"),
  }),
};

/**
 * Client OTP verify: phone + code
 */
export const clientOtpVerifySchema: ValidationSchemas = {
  body: z.object({
    phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone number format (E.164)"),
    code: z.string().length(6, "OTP code must be 6 digits"),
  }),
};

/**
 * Artist OTP request: phone
 */
export const artistOtpRequestSchema: ValidationSchemas = {
  body: z.object({
    phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone number format (E.164)"),
  }),
};

/**
 * Artist OTP verify: phone + code
 */
export const artistOtpVerifySchema: ValidationSchemas = {
  body: z.object({
    phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone number format (E.164)"),
    code: z.string().length(6, "OTP code must be 6 digits"),
  }),
};

/**
 * Refresh token: refresh token
 */
export const refreshTokenSchema: ValidationSchemas = {
  body: z.object({
    refreshToken: z.string().min(1, "Refresh token is required"),
  }),
};

/**
 * Logout: no body required (uses auth context)
 */
export const logoutSchema: ValidationSchemas = {
  body: z.object({}).optional(),
};

/**
 * GET /me: no body required (uses auth context)
 */
export const meSchema: ValidationSchemas = {
  body: z.object({}).optional(),
};

// Export types for use in controllers
export type StaffLoginInput = z.infer<typeof staffLoginSchema.body>;
export type StaffPasswordResetRequestInput = z.infer<typeof staffPasswordResetRequestSchema.body>;
export type StaffPasswordResetConfirmInput = z.infer<typeof staffPasswordResetConfirmSchema.body>;
export type ClientOtpRequestInput = z.infer<typeof clientOtpRequestSchema.body>;
export type ClientOtpVerifyInput = z.infer<typeof clientOtpVerifySchema.body>;
export type ArtistOtpRequestInput = z.infer<typeof artistOtpRequestSchema.body>;
export type ArtistOtpVerifyInput = z.infer<typeof artistOtpVerifySchema.body>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema.body>;
export type LogoutInput = z.infer<typeof logoutSchema.body>;