import { Request, Response, NextFunction } from 'express';
import { catalogueService } from './catalogue.service.js';
import { successResponse } from '../shared/responses/index.js';
import { AppError } from '../shared/errors/index.js';
import { z } from 'zod';

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const serviceFiltersSchema = z.object({
  categoryId: z.string().cuid().optional(),
  subcategoryId: z.string().cuid().optional(),
  gender: z.enum(['MALE', 'FEMALE', 'UNISEX']).optional(),
  active: z.coerce.boolean().optional(),
  search: z.string().optional(),
});

const productFiltersSchema = z.object({
  categoryId: z.string().cuid().optional(),
  type: z.enum(['RETAIL', 'TOOLS', 'SALON_USE']).optional(),
  active: z.coerce.boolean().optional(),
  search: z.string().optional(),
  inStock: z.coerce.boolean().optional(),
});

const artistFiltersSchema = z.object({
  specialization: z.string().optional(),
  isAvailable: z.coerce.boolean().optional(),
  activeOnly: z.coerce.boolean().optional(),
  search: z.string().optional(),
});

export class CatalogueController {
  async getServices(req: Request, res: Response, next: NextFunction) {
    try {
      const pagination = paginationSchema.parse(req.query);
      const filters = serviceFiltersSchema.parse(req.query);

      const result = await catalogueService.getServices(filters, pagination);
      res.status(200).json(successResponse(result, req.requestContext.requestId));
    } catch (err) {
      next(err);
    }
  }

  async getServiceById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const serviceId = Array.isArray(id) ? id[0] : id;
      const service = await catalogueService.getServiceById(serviceId);

      if (!service) {
        throw new AppError(404, 'NOT_FOUND', 'Service not found');
      }

      res.status(200).json(successResponse(service, req.requestContext.requestId));
    } catch (err) {
      next(err);
    }
  }

  async getServiceCategories(req: Request, res: Response, next: NextFunction) {
    try {
      const activeOnly = req.query.activeOnly !== 'false';
      const categories = await catalogueService.getServiceCategories(activeOnly);
      res.status(200).json(successResponse(categories, req.requestContext.requestId));
    } catch (err) {
      next(err);
    }
  }

  async getServiceSubcategories(req: Request, res: Response, next: NextFunction) {
    try {
      const { categoryId } = req.params;
      const catId = Array.isArray(categoryId) ? categoryId[0] : categoryId;
      const activeOnly = req.query.activeOnly !== 'false';
      const subcategories = await catalogueService.getServiceSubcategories(catId, activeOnly);
      res.status(200).json(successResponse(subcategories, req.requestContext.requestId));
    } catch (err) {
      next(err);
    }
  }

  async getProducts(req: Request, res: Response, next: NextFunction) {
    try {
      const pagination = paginationSchema.parse(req.query);
      const filters = productFiltersSchema.parse(req.query);

      const result = await catalogueService.getProducts(filters, pagination);
      res.status(200).json(successResponse(result, req.requestContext.requestId));
    } catch (err) {
      next(err);
    }
  }

  async getProductById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const productId = Array.isArray(id) ? id[0] : id;
      const product = await catalogueService.getProductById(productId);

      if (!product) {
        throw new AppError(404, 'NOT_FOUND', 'Product not found');
      }

      res.status(200).json(successResponse(product, req.requestContext.requestId));
    } catch (err) {
      next(err);
    }
  }

  async getProductCategories(req: Request, res: Response, next: NextFunction) {
    try {
      const activeOnly = req.query.activeOnly !== 'false';
      const categories = await catalogueService.getProductCategories(activeOnly);
      res.status(200).json(successResponse(categories, req.requestContext.requestId));
    } catch (err) {
      next(err);
    }
  }

  async getArtists(req: Request, res: Response, next: NextFunction) {
    try {
      const pagination = paginationSchema.parse(req.query);
      const filters = artistFiltersSchema.parse(req.query);

      const result = await catalogueService.getArtists(filters, pagination);
      res.status(200).json(successResponse(result, req.requestContext.requestId));
    } catch (err) {
      next(err);
    }
  }

  async getArtistById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const artistId = Array.isArray(id) ? id[0] : id;
      const artist = await catalogueService.getArtistById(artistId);

      if (!artist) {
        throw new AppError(404, 'NOT_FOUND', 'Artist not found');
      }

      res.status(200).json(successResponse(artist, req.requestContext.requestId));
    } catch (err) {
      next(err);
    }
  }
}

export const catalogueController = new CatalogueController();