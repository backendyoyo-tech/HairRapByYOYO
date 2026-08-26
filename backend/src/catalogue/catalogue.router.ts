import { Router } from 'express';
import { catalogueController } from './catalogue.controller.js';

export const catalogueRouter = Router();

// Service endpoints
catalogueRouter.get('/services', catalogueController.getServices);
catalogueRouter.get('/services/categories', catalogueController.getServiceCategories);
catalogueRouter.get('/services/categories/:categoryId/subcategories', catalogueController.getServiceSubcategories);
catalogueRouter.get('/services/:id', catalogueController.getServiceById);

// Product endpoints
catalogueRouter.get('/products', catalogueController.getProducts);
catalogueRouter.get('/products/categories', catalogueController.getProductCategories);
catalogueRouter.get('/products/:id', catalogueController.getProductById);

// Artist endpoints
catalogueRouter.get('/artists', catalogueController.getArtists);
catalogueRouter.get('/artists/:id', catalogueController.getArtistById);