export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export interface ApiFieldError {
  field: string;
  message: string;
  code: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  fields?: ApiFieldError[];
  requestId?: string;
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}