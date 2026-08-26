import "dotenv/config";
import { PrismaClient } from "./src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword, verifyPassword } from "./src/auth/auth.utils.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not loaded from .env");
}

const adapter = new PrismaPg({
  connectionString: databaseUrl,
});

const prisma = new PrismaClient({ adapter });

const email = "admin@hairrap.local";
const newPassword = "Admin@123";

async function resetAdminPassword() {
  try {
    console.log("========================================");
    console.log("RESETTING STAFF ADMIN PASSWORD");
    console.log("========================================");
    console.log("EMAIL:", email);

    // Generate a new password hash using the application's
    // existing PBKDF2 hashing implementation.
    const passwordHash = await hashPassword(newPassword);

    console.log("NEW PASSWORD HASH GENERATED: true");

    // Update only the passwordHash of this account.
    const account = await prisma.account.update({
      where: {
        email,
      },
      data: {
        passwordHash,
      },
      select: {
        id: true,
        email: true,
        accountType: true,
        role: true,
        isActive: true,
        isVerified: true,
        passwordHash: true,
      },
    });

    console.log("ACCOUNT UPDATED SUCCESSFULLY");
    console.log("----------------------------------------");
    console.log("ID:", account.id);
    console.log("EMAIL:", account.email);
    console.log("ACCOUNT TYPE:", account.accountType);
    console.log("ROLE:", account.role);
    console.log("ACTIVE:", account.isActive);
    console.log("VERIFIED:", account.isVerified);

    // Verify the newly generated/stored hash.
    const passwordValid = await verifyPassword(
      newPassword,
      account.passwordHash!
    );

    console.log("----------------------------------------");
    console.log("PASSWORD VERIFICATION:", passwordValid);
    console.log("========================================");

    if (!passwordValid) {
      throw new Error(
        "Password was updated but verification failed."
      );
    }

    console.log("✅ ADMIN PASSWORD RESET SUCCESSFUL");
    console.log("Login with:");
    console.log("Email: admin@hairrap.local");
    console.log("Password: Admin@123");
    console.log("========================================");
  } catch (error) {
    console.error("❌ PASSWORD RESET FAILED:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

resetAdminPassword();