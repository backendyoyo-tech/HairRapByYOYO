// vitest.setup.ts - Global test setup that runs BEFORE any test files
import { vi } from 'vitest';

// Mock @prisma/client/runtime/client FIRST - this is imported by generated Prisma client
vi.mock('@prisma/client/runtime/client', () => ({
  Prisma: {
    ModelName: {},
    RejectOnNotFound: class extends Error { constructor() { super(); } },
    RejectPerModel: class extends Error { constructor() { super(); } },
    validator: () => true,
  },
  NullTypes: {
    DbNull: Symbol('DbNull'),
    JsonNull: Symbol('JsonNull'),
    AnyNull: Symbol('AnyNull'),
  },
  Extensions: {
    getExtensionContext: () => ({}),
    UserArgs: {},
  },
  PrismaClientRuntime: {
    getDatasource: () => ({}),
    getExtensions: () => [],
    getOptions: () => ({}),
    transaction: () => Promise.resolve(),
  },
  Types: {
    Extensions: { UserArgs: {} },
    PublicOperation: {},
  },
  runtime: {
    Prisma: {},
    PrismaClientRuntime: {},
    Extensions: {},
    Types: {},
    NullTypes: {},
    getPrismaClient: (config?: any) => class MockPrismaClient {
      constructor() { return {}; }
    },
  },
  Decimal: class { constructor(public value: string | number) {} toString() { return this.value.toString(); } toNumber() { return Number(this.value); } equals(other: any) { return this.value === other.value; } lessThan(other: any) { return this.value < other.value; } greaterThan(other: any) { return this.value > other.value; } },
  Bytes: class { constructor(public value: Buffer) {} },
  DbNull: Symbol('DbNull'),
  JsonNull: Symbol('JsonNull'),
  AnyNull: Symbol('AnyNull'),
  objectEnumValues: <T>(obj: T): T[keyof T][] => Object.values(obj) as T[keyof T][],
  makeStrictEnum: <T>(values: any): T => Array.isArray(values) ? Object.freeze(values.reduce((acc: any, v: string) => ({ ...acc, [v]: v }), {})) as T : values as T,
  Engine: {},
  Datasource: {},
  DMMF: {},
  queryOptions: {},
  skip: Symbol('skip'),
  dmmf: {},
  TransactionIsolationLevel: { ReadUncommitted: 'ReadUncommitted', ReadCommitted: 'ReadCommitted', RepeatableRead: 'RepeatableRead', Serializable: 'Serializable' },
  PrismaPromise: class<T> extends Promise<T> { constructor(executor: (resolve: (value: T) => void, reject: (reason: any) => void) => void) { super(executor); } },
  PrismaClientKnownRequestError: class extends Error {
    constructor(message: string, code: string, clientVersion: string) {
      super(message);
      this.name = 'PrismaClientKnownRequestError';
      this.code = code;
      this.clientVersion = clientVersion;
    }
    code: string;
    clientVersion: string;
  },
  PrismaClientUnknownRequestError: class extends Error {
    constructor(message: string, clientVersion: string) {
      super(message);
      this.name = 'PrismaClientUnknownRequestError';
      this.clientVersion = clientVersion;
    }
    clientVersion: string;
  },
  PrismaClientRustPanicError: class extends Error {
    constructor(message: string, clientVersion: string) {
      super(message);
      this.name = 'PrismaClientRustPanicError';
      this.clientVersion = clientVersion;
    }
    clientVersion: string;
  },
  PrismaClientInitializationError: class extends Error {
    constructor(message: string, clientVersion: string) {
      super(message);
      this.name = 'PrismaClientInitializationError';
      this.clientVersion = clientVersion;
    }
    clientVersion: string;
  },
  PrismaClientValidationError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'PrismaClientValidationError';
    }
  },
}));

// Mock @prisma/adapter-pg
vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class {
    constructor(config?: any) { this.config = config; }
    query = () => Promise.resolve([]);
    queryRaw = () => Promise.resolve([]);
    executeRaw = () => Promise.resolve(0);
    transaction = (fn: any) => fn(this);
  },
}));

// Create mock Prisma client
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
  $transaction: vi.fn((cb: any) => cb(mockPrisma)),
};

// Mock all Prisma entry points
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

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}));

// Mock availability service
const mockAvailabilityService = {
  validateSlotAvailability: vi.fn().mockResolvedValue(true),
  searchAvailability: vi.fn().mockResolvedValue([]),
};

vi.mock('../src/booking/availability.service.js', () => ({
  availabilityService: mockAvailabilityService,
}));

// Mock shared modules
vi.mock('../shared/errors/index.js', () => ({
  AppError: class extends Error {
    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = 'AppError';
      this.status = status;
      this.code = code;
    }
    status: number;
    code: string;
  },
}));

vi.mock('../shared/responses/index.js', () => ({
  successResponse: (data: any, requestId?: string) => ({ success: true, data, requestId }),
  errorResponse: (error: any, requestId?: string) => ({ success: false, error, requestId }),
}));

vi.mock('../shared/contracts/index.js', () => ({
  ValidationSchemas: {},
}));

// Export for tests to use
export { mockPrisma, mockAvailabilityService };