import { PrismaClient } from './generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface ServiceFilters {
  categoryId?: string;
  subcategoryId?: string;
  gender?: 'MALE' | 'FEMALE' | 'UNISEX';
  active?: boolean;
  search?: string;
}

export interface ProductFilters {
  categoryId?: string;
  type?: 'RETAIL' | 'TOOLS' | 'SALON_USE';
  active?: boolean;
  search?: string;
  inStock?: boolean;
}

export interface ArtistFilters {
  specialization?: string;
  isAvailable?: boolean;
  activeOnly?: boolean;
  search?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class CatalogueService {
  async getServices(
    filters: ServiceFilters = {},
    pagination: PaginationParams = { page: 1, limit: 20 }
  ): Promise<PaginatedResult<any>> {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (filters.active !== undefined) where.active = filters.active;
    else where.active = true; // default to active only

    if (filters.categoryId) {
      where.subcategory = { categoryId: filters.categoryId };
    }

    if (filters.subcategoryId) {
      where.subcategoryId = filters.subcategoryId;
    }

    if (filters.gender) {
      where.gender = filters.gender;
    }

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.service.findMany({
        where,
        include: {
          subcategory: {
            include: { category: true },
          },
        },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        skip,
        take: limit,
      }),
      prisma.service.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getServiceById(id: string): Promise<any | null> {
    return prisma.service.findUnique({
      where: { id },
      include: {
        subcategory: {
          include: { category: true },
        },
        artistServices: {
          where: { isActive: true },
          include: {
            artist: {
              include: { account: true },
            },
          },
        },
        serviceProductSuggestions: {
          include: { product: true },
        },
      },
    });
  }

  async getServiceCategories(activeOnly = true): Promise<any[]> {
    return prisma.serviceCategory.findMany({
      where: activeOnly ? { isActive: true } : {},
      include: {
        subcategories: {
          where: activeOnly ? { isActive: true } : {},
          orderBy: { displayOrder: 'asc' },
        },
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async getServiceSubcategories(categoryId: string, activeOnly = true): Promise<any[]> {
    return prisma.serviceSubcategory.findMany({
      where: {
        categoryId,
        ...(activeOnly ? { isActive: true } : {}),
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async getProducts(
    filters: ProductFilters = {},
    pagination: PaginationParams = { page: 1, limit: 20 }
  ): Promise<PaginatedResult<any>> {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (filters.active !== undefined) where.isActive = filters.active;
    else where.isActive = true;

    if (filters.categoryId) {
      where.categoryId = filters.categoryId;
    }

    if (filters.type) {
      where.type = filters.type;
    }

    if (filters.inStock) {
      where.stockQty = { gt: 0 };
    }

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { sku: { contains: filters.search, mode: 'insensitive' } },
        { barcode: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { category: true },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        skip,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getProductById(id: string): Promise<any | null> {
    return prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        serviceProductSuggestions: {
          include: { service: true },
        },
      },
    });
  }

  async getProductCategories(activeOnly = true): Promise<any[]> {
    return prisma.productCategory.findMany({
      where: activeOnly ? { isActive: true } : {},
      include: {
        products: {
          where: activeOnly ? { isActive: true } : {},
          orderBy: { displayOrder: 'asc' },
        },
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async getArtists(
    filters: ArtistFilters = {},
    pagination: PaginationParams = { page: 1, limit: 20 }
  ): Promise<PaginatedResult<any>> {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (filters.activeOnly !== false) {
      where.isAvailable = true;
      where.account = { isActive: true, accountType: 'ARTIST' };
    }

    if (filters.specialization) {
      where.specialization = { contains: filters.specialization, mode: 'insensitive' };
    }

    if (filters.isAvailable !== undefined) {
      where.isAvailable = filters.isAvailable;
    }

    if (filters.search) {
      where.OR = [
        { firstName: { contains: filters.search, mode: 'insensitive' } },
        { lastName: { contains: filters.search, mode: 'insensitive' } },
        { displayName: { contains: filters.search, mode: 'insensitive' } },
        { specialization: { contains: filters.search, mode: 'insensitive' } },
        { bio: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.artistProfile.findMany({
        where,
        include: {
          account: true,
          artistServices: {
            where: { isActive: true },
            include: { service: { include: { subcategory: { include: { category: true } } } } },
          },
        },
        orderBy: [{ displayName: 'asc' }],
        skip,
        take: limit,
      }),
      prisma.artistProfile.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getArtistById(id: string): Promise<any | null> {
    return prisma.artistProfile.findUnique({
      where: { id },
      include: {
        account: true,
        artistServices: {
          where: { isActive: true },
          include: { service: { include: { subcategory: { include: { category: true } } } } },
        },
      },
    });
  }
}

export const catalogueService = new CatalogueService();