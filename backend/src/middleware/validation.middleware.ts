import type { NextFunction, Request, Response } from "express";

import { AppError } from "../shared/errors/index.js";
import type { ValidationSchemas } from "../shared/contracts/index.js";

export function validate(
  schemas: ValidationSchemas,
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const fieldErrors: {
      field: string;
      code: string;
      message?: string;
    }[] = [];

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);

      if (!result.success) {
        for (const issue of result.error.issues) {
          fieldErrors.push({
            field: issue.path.join("."),
            code: issue.code,
            message: issue.message,
          });
        }
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);

      if (!result.success) {
        for (const issue of result.error.issues) {
          fieldErrors.push({
            field: issue.path.join("."),
            code: issue.code,
            message: issue.message,
          });
        }
      }
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);

      if (!result.success) {
        for (const issue of result.error.issues) {
          fieldErrors.push({
            field: issue.path.join("."),
            code: issue.code,
            message: issue.message,
          });
        }
      }
    }

    if (fieldErrors.length > 0) {
      next(
        new AppError(
          400,
          "VALIDATION_FAILED",
          "Request validation failed.",
          {
            fieldErrors,
          },
        ),
      );

      return;
    }

    next();
  };
}