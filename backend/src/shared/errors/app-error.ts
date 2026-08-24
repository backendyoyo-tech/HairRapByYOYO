import type {
  ApiFieldError,
  ApiErrorBody,
} from "../contracts/index.js";

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly fieldErrors?: ApiFieldError[];
  public readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options?: {
      fieldErrors?: ApiFieldError[];
      details?: Record<string, unknown>;
    },
  ) {
    super(message);

    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.fieldErrors = options?.fieldErrors;
    this.details = options?.details;
  }

  toApiError(): ApiErrorBody {
    return {
      code: this.code,
      message: this.message,
      ...(this.fieldErrors
        ? { field_errors: this.fieldErrors }
        : {}),
      ...(this.details
        ? { details: this.details }
        : {}),
    };
  }
}