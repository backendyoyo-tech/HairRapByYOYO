// Mock @prisma/client/runtime/client to prevent parsing issues with generated Prisma client
// The generated Prisma client imports this as: import * as runtime from "@prisma/client/runtime/client"

export const Prisma = {
  // Prisma namespace types needed by generated client
  ModelName: {},
  RejectOnNotFound: class extends Error { constructor() { super(); } },
  RejectPerModel: class extends Error { constructor() { super(); } },
  validator: () => true,
};

export const NullTypes = {
  DbNull: Symbol('DbNull'),
  JsonNull: Symbol('JsonNull'),
  AnyNull: Symbol('AnyNull'),
};

export const Extensions = {
  getExtensionContext: () => ({}),
  UserArgs: {},
};

export const PrismaClientRuntime = {
  getDatasource: () => ({}),
  getExtensions: () => [],
  getOptions: () => ({}),
  transaction: () => Promise.resolve(),
};

export const Types = {
  Extensions: {
    UserArgs: {},
  },
  PublicOperation: {},
};

// Also export as runtime (what the generated code expects)
export const runtime = {
  Prisma,
  PrismaClientRuntime,
  Extensions,
  Types,
  NullTypes,
  getPrismaClient: (config?: any) => {
    return class MockPrismaClient {
      constructor() {
        return {};
      }
    };
  },
  sqltag: (strings: TemplateStringsArray, ...values: any[]) => {
    return strings.reduce((acc, str, i) => acc + str + (values[i] || ''), '');
  },
  empty: '',
  join: (separator: string, values: any[]) => values.join(separator),
};

// Export individual items that might be used
export const Decimal = class {
  constructor(public value: string | number) {}
  toString() { return this.value.toString(); }
  toNumber() { return Number(this.value); }
  equals(other: any) { return this.value === other.value; }
  lessThan(other: any) { return this.value < other.value; }
  greaterThan(other: any) { return this.value > other.value; }
};

export const Bytes = class {
  constructor(public value: Buffer) {}
};

// Also export as named exports (direct)
export const DbNull = Symbol('DbNull');
export const JsonNull = Symbol('JsonNull');
export const AnyNull = Symbol('AnyNull');

// Helper functions that might be used
export function objectEnumValues<T>(obj: T): T[keyof T][] {
  return Object.values(obj) as T[keyof T][];
}
export function makeStrictEnum<T>(values: any): T {
  if (Array.isArray(values)) {
    return Object.freeze(values.reduce((acc: any, v: string) => ({ ...acc, [v]: v }), {})) as T;
  }
  return values as T;
}

// Prisma client internal symbols
export const Engine = {};
export const Datasource = {};
export const DMMF = {};
export const queryOptions = {};
export const skip = Symbol('skip');
export const dmmf = {};

// Transaction isolation levels
export const TransactionIsolationLevel = {
  ReadUncommitted: 'ReadUncommitted',
  ReadCommitted: 'ReadCommitted',
  RepeatableRead: 'RepeatableRead',
  Serializable: 'Serializable',
};

// Prisma Promise
export class PrismaPromise<T> extends Promise<T> {
  constructor(executor: (resolve: (value: T) => void, reject: (reason: any) => void) => void) {
    super(executor);
  }
}