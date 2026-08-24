// import type { ErrorRequestHandler } from "express";
// import { AppError } from "../shared/errors/index.js";

// export const errorHandler: ErrorRequestHandler = (
//     error,
//     req,
//     res,
//     _next,
// ) => {
//     const requestId = req.requestContext?.requestId ?? "unknown";
//     console.log("DEBUG ERROR:", {
//         isAppError: error instanceof AppError,
//         name: error instanceof Error ? error.name : typeof error,
//         constructor: error instanceof Error ? error.constructor.name : "unknown",
//         code: error instanceof AppError ? error.code : undefined,
//         statusCode: error instanceof AppError ? error.statusCode : undefined,
//     });
//     if (error instanceof AppError) {
//         res.status(error.statusCode).json({
//             error: error.toApiError(),
//             request_id: requestId,
//         });

//         return;
//     }

//     console.error("Unhandled application error", {
//         requestId,
//         errorName: error instanceof Error ? error.name : "UnknownError",
//         errorMessage: error instanceof Error ? error.message : String(error),
//     });

//     res.status(500).json({
//         error: {
//             code: "INTERNAL_SERVER_ERROR",
//             message: "An unexpected error occurred.",
//         },
//         request_id: requestId,
//     });
// };

import type { ErrorRequestHandler } from "express";
import { AppError } from "../shared/errors/index.js";

export const errorHandler: ErrorRequestHandler = (
  error,
  req,
  res,
  _next,
) => {
//   console.log("DEBUG ERROR HANDLER:", {
//     isAppError: error instanceof AppError,
//     name: error instanceof Error ? error.name : typeof error,
//     constructor:
//       error instanceof Error ? error.constructor.name : "unknown",
//     message:
//       error instanceof Error ? error.message : String(error),
//     code: error instanceof AppError ? error.code : undefined,
//     statusCode: error instanceof AppError
//       ? error.statusCode
//       : undefined,
//     requestId: req.requestContext?.requestId,
//   });

  const requestId = req.requestContext?.requestId ?? "unknown";

  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: error.toApiError(),
      request_id: requestId,
    });

    return;
  }

  console.error("Unhandled application error", {
    requestId,
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage: error instanceof Error ? error.message : String(error),
  });

  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
    },
    request_id: requestId,
  });
};