import type { NextFunction, Request, Response } from "express";
import { createRequestContext } from "../shared/logging/request-context.js";

declare global {
  namespace Express {
    interface Request {
      requestContext: {
        requestId: string;
      };
    }
  }
}

export function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incomingRequestId = req.header("X-Request-Id");

  const context = createRequestContext(incomingRequestId);

  req.requestContext = context;

  res.setHeader("X-Request-Id", context.requestId);

  next();
}