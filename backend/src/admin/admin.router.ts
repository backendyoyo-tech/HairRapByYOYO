import { Router } from "express";
import { validate } from "../middleware/validation.middleware.js";
import { requireAuth } from "../auth/actor.middleware.js";
import { requireSimplePermission } from "../auth/rbac.middleware.js";
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";
import { successResponse } from "../shared/responses/index.js";
import { AppError } from "../shared/errors/index.js";
import { hashPassword } from "../auth/auth.utils.js";
import { logAuthEvent, AuditAction } from "../auth/audit.service.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:***@localhost:5432/postgres?schema=public" });
const prisma = new PrismaClient({ adapter });

const router = Router();

// All admin routes require authentication
router.use(requireAuth);

/**
 * GET /api/v1/admin/staff-users
 * Super Admin only - List staff users
 */
router.get(
  "/staff-users",
  requireSimplePermission("manage_staff_users_roles"),
  async (req, res) => {
    const accounts = await prisma.account.findMany({
      where: { accountType: "STAFF" },
      include: {
        staffProfile: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const staffUsers = accounts.map((account) => ({
      accountId: account.id,
      email: account.email,
      username: account.username,
      role: account.role,
      isActive: account.isActive,
      isVerified: account.isVerified,
      lastLoginAt: account.lastLoginAt,
      createdAt: account.createdAt,
      staffProfile: account.staffProfile
        ? {
            id: account.staffProfile.id,
            firstName: account.staffProfile.firstName,
            lastName: account.staffProfile.lastName,
            employeeId: account.staffProfile.employeeId,
          }
        : null,
    }));

    res.status(200).json(
      successResponse({ staffUsers }, req.requestContext.requestId)
    );
  }
);

/**
 * POST /api/v1/admin/staff-users
 * Super Admin only - Create staff account with Receptionist/Admin/Super Admin role
 */
router.post(
  "/staff-users",
  requireSimplePermission("manage_staff_users_roles"),
  validate({
    body: z.object({
      email: z.string().email("Invalid email format"),
      username: z.string().min(3, "Username must be at least 3 characters").optional(),
      password: z.string().min(8, "Password must be at least 8 characters"),
      role: z.enum(["RECEPTIONIST", "ADMIN", "SUPER_ADMIN"]),
      firstName: z.string().min(1, "First name is required"),
      lastName: z.string().min(1, "Last name is required"),
      employeeId: z.string().min(1, "Employee ID is required"),
    }),
  }),
  async (req, res) => {
    const { email, username, password, role, firstName, lastName, employeeId } = req.body;
    const currentActor = req.actor;

    // Check if email already exists
    const existingByEmail = await prisma.account.findUnique({ where: { email } });
    if (existingByEmail) {
      throw new AppError(409, "EMAIL_ALREADY_EXISTS", "An account with this email already exists.");
    }

    // Check if username already exists (if provided)
    if (username) {
      const existingByUsername = await prisma.account.findUnique({ where: { username } });
      if (existingByUsername) {
        throw new AppError(409, "USERNAME_ALREADY_EXISTS", "An account with this username already exists.");
      }
    }

    // Check if employeeId already exists
    const existingEmployeeId = await prisma.staffProfile.findUnique({ where: { employeeId } });
    if (existingEmployeeId) {
      throw new AppError(409, "EMPLOYEE_ID_ALREADY_EXISTS", "An account with this employee ID already exists.");
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create account and staff profile in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: {
          email,
          username: username || null,
          passwordHash,
          role,
          accountType: "STAFF",
          isActive: true,
          isVerified: true,
        },
      });

      const staffProfile = await tx.staffProfile.create({
        data: {
          accountId: account.id,
          firstName,
          lastName,
          employeeId,
        },
      });

      return { account, staffProfile };
    });

    await logAuthEvent({
      accountId: currentActor?.accountId,
      actorType: "STAFF",
      actorId: currentActor?.actorId,
      action: AuditAction.ACCOUNT_CREATED,
      metadata: {
        createdAccountId: result.account.id,
        createdEmail: email,
        createdRole: role,
        createdBy: currentActor?.actorId,
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      success: true,
    });

    res.status(201).json(
      successResponse(
        {
          accountId: result.account.id,
          email: result.account.email,
          username: result.account.username,
          role: result.account.role,
          staffProfile: {
            id: result.staffProfile.id,
            firstName: result.staffProfile.firstName,
            lastName: result.staffProfile.lastName,
            employeeId: result.staffProfile.employeeId,
          },
        },
        req.requestContext.requestId
      )
    );
  }
);

export default router;