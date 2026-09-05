// Prisma Pg adapter mock - must use a proper class for `new PrismaPg()`
import { vi } from 'vitest';

// Define the class first
class MockPrismaPg {
  constructor(config?: any) {
    this.config = config;
  }
  query = () => Promise.resolve([]);
  queryRaw = () => Promise.resolve([]);
  executeRaw = () => Promise.resolve(0);
  transaction = (fn: any) => fn(this);
}

// Then mock the module
vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: MockPrismaPg,
}));

export {};