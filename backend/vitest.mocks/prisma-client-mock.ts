// Prisma Client Mock for Vitest Tests
// This file provides a mock PrismaClient that tests can import

import { vi } from 'vitest';

// Create a comprehensive mock Prisma client
const mockPrisma = {
  booking: {
    findUnique: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
  },
  bookingService: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  bookingServiceAssignment: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  bookingHold: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  bookingHoldResource: {
    create: vi.fn(),
  },
  bookingQuote: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  bookingStatusHistory: {
    create: vi.fn(),
  },
  bookingRescheduleHistory: {
    create: vi.fn(),
  },
  artistService: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  artistProfile: {
    findUnique: vi.fn(),
  },
  artistWorkSchedule: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  artistScheduleException: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  service: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  idempotencyKey: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  $transaction: vi.fn((cb) => cb(mockPrisma)),
};

// Mock all Prisma client entry points globally
vi.mock('../src/booking/generated/prisma/client.js', () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}));

vi.mock('../src/auth/generated/prisma/client.js', () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}));

vi.mock('../src/shared/generated/prisma/client.js', () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}));

vi.mock('./generated/prisma/client.js', () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}));

// Mock @prisma/client if imported directly
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}));

// Mock @prisma/adapter-pg
vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: vi.fn().mockImplementation(() => ({})),
}));

// Export for tests to use
export { mockPrisma };

// Reset mocks before each test
import { beforeEach } from 'vitest';

beforeEach(() => {
  vi.clearAllMocks();
  // Re-initialize $transaction
  mockPrisma.$transaction.mockImplementation((cb) => cb(mockPrisma));
});