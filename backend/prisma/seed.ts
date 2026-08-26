#!/usr/bin/env node
/**
 * Development seed script for SUPER_ADMIN staff account.
 * Run with: npx tsx prisma/seed.ts
 * This script is idempotent - safe to run multiple times.
 */

import "dotenv/config";
import { PrismaClient } from "../prisma/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/auth/auth.utils.js";

// Use the same DATABASE_URL as the app
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Development seed credentials - NEVER use in production!
const SEED_SUPER_ADMIN = {
  email: "admin@hairrap.local",
  username: "superadmin",
  password: "Admin@123",
  role: "SUPER_ADMIN" as const,
  firstName: "Super",
  lastName: "Admin",
  employeeId: "EMP-0001",
};

async function main() {
  console.log("🌱 Starting development seed...");

  try {
    // Check if SUPER_ADMIN already exists
    const existingAccount = await prisma.account.findUnique({
      where: { email: SEED_SUPER_ADMIN.email },
      include: { staffProfile: true },
    });

    if (existingAccount) {
      console.log("✅ SUPER_ADMIN account already exists:");
      console.log(`   Email: ${existingAccount.email}`);
      console.log(`   Username: ${existingAccount.username}`);
      console.log(`   Role: ${existingAccount.role}`);
      console.log(`   Active: ${existingAccount.isActive}`);
      if (existingAccount.staffProfile) {
        console.log(`   Employee ID: ${existingAccount.staffProfile.employeeId}`);
        console.log(`   Name: ${existingAccount.staffProfile.firstName} ${existingAccount.staffProfile.lastName}`);
      }
      console.log("\n📋 Development login credentials:");
      console.log(`   Email: ${SEED_SUPER_ADMIN.email}`);
      console.log(`   Password: ${SEED_SUPER_ADMIN.password}`);
      console.log("\n⚠️  These are development-only credentials. NEVER use in production!");
      return;
    }

    // Check if username is taken
    const existingUsername = await prisma.account.findUnique({
      where: { username: SEED_SUPER_ADMIN.username },
    });

    if (existingUsername) {
      console.log("❌ Username 'superadmin' already exists but with different email.");
      console.log("   Please resolve manually or delete the existing account first.");
      process.exit(1);
    }

    // Check if employeeId is taken
    const existingEmployeeId = await prisma.staffProfile.findUnique({
      where: { employeeId: SEED_SUPER_ADMIN.employeeId },
    });

    if (existingEmployeeId) {
      console.log("❌ Employee ID 'EMP-0001' already exists.");
      console.log("   Please resolve manually or delete the existing staff profile first.");
      process.exit(1);
    }

    // Hash the password
    const passwordHash = await hashPassword(SEED_SUPER_ADMIN.password);

    // Create account and staff profile in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: {
          email: SEED_SUPER_ADMIN.email,
          username: SEED_SUPER_ADMIN.username,
          passwordHash,
          role: SEED_SUPER_ADMIN.role,
          accountType: "STAFF",
          isActive: true,
          isVerified: true,
        },
      });

      const staffProfile = await tx.staffProfile.create({
        data: {
          accountId: account.id,
          firstName: SEED_SUPER_ADMIN.firstName,
          lastName: SEED_SUPER_ADMIN.lastName,
          employeeId: SEED_SUPER_ADMIN.employeeId,
        },
      });

      return { account, staffProfile };
    });

    console.log("✅ SUPER_ADMIN account created successfully!");
    console.log(`   Account ID: ${result.account.id}`);
    console.log(`   Email: ${result.account.email}`);
    console.log(`   Username: ${result.account.username}`);
    console.log(`   Role: ${result.account.role}`);
    console.log(`   Staff Profile ID: ${result.staffProfile.id}`);
    console.log(`   Employee ID: ${result.staffProfile.employeeId}`);
    console.log(`   Name: ${result.staffProfile.firstName} ${result.staffProfile.lastName}`);
    console.log("\n📋 Development login credentials:");
    console.log(`   Email: ${SEED_SUPER_ADMIN.email}`);
    console.log(`   Password: ${SEED_SUPER_ADMIN.password}`);
    console.log("\n⚠️  These are development-only credentials. NEVER use in production!");

  } catch (error) {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();