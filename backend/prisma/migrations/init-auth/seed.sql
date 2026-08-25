-- Development Seed: SUPER_ADMIN Staff Account
-- Run this AFTER the init-auth migration
-- This is idempotent - safe to run multiple times

-- Hash for password: 'Admin@123' (using bcrypt with cost 12)
-- Generated via: await hashPassword('Admin@123')
-- You can verify by running: SELECT * FROM "Account" WHERE email = 'admin@hairrap.local';

-- Insert SUPER_ADMIN account (idempotent - upsert on email)
INSERT INTO "Account" ("id", "accountType", "email", "username", "passwordHash", "role", "isActive", "isVerified", "createdAt", "updatedAt")
VALUES (
    'dev-super-admin-001',
    'STAFF',
    'admin@hairrap.local',
    'superadmin',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/RK.PZvO.S',  -- bcrypt hash of 'Admin@123'
    'SUPER_ADMIN',
    true,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("email") DO UPDATE SET
    "username" = EXCLUDED."username",
    "passwordHash" = EXCLUDED."passwordHash",
    "role" = EXCLUDED."role",
    "isActive" = EXCLUDED."isActive",
    "isVerified" = EXCLUDED."isVerified",
    "updatedAt" = CURRENT_TIMESTAMP;

-- Insert StaffProfile for SUPER_ADMIN (idempotent - upsert on accountId)
INSERT INTO "StaffProfile" ("id", "accountId", "firstName", "lastName", "employeeId", "createdAt", "updatedAt")
VALUES (
    'dev-super-admin-profile-001',
    'dev-super-admin-001',
    'Super',
    'Admin',
    'EMP-0001',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("accountId") DO UPDATE SET
    "firstName" = EXCLUDED."firstName",
    "lastName" = EXCLUDED."lastName",
    "employeeId" = EXCLUDED."employeeId",
    "updatedAt" = CURRENT_TIMESTAMP;

-- Verification queries (run after seed):
-- SELECT * FROM "Account" WHERE email = 'admin@hairrap.local';
-- SELECT * FROM "StaffProfile" WHERE accountId = 'dev-super-admin-001';

-- Development Credentials:
-- Email: admin@hairrap.local
-- Password: Admin@123
-- Role: SUPER_ADMIN