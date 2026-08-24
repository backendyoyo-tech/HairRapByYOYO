// export interface ApiMeta {
//   page?: number;
//   pageSize?: number;
//   total?: number;
//   totalPages?: number;
//   sortBy?: string;
//   sortOrder?: "asc" | "desc";
// }

// export interface ApiSuccessResponse<T> {
//   data: T;
//   meta?: ApiMeta;
//   request_id: string;
// }

// export interface ApiFieldError {
//   field: string;
//   code: string;
//   message?: string;
// }

// export interface ApiErrorBody {
//   code: string;
//   message: string;
//   field_errors?: ApiFieldError[];
//   details?: Record<string, unknown>;
// }

// export interface ApiErrorResponse {
//   error: ApiErrorBody;
//   request_id: string;
// }

import type { PaginationMeta } from "../pagination/index.js";

export interface ApiSuccessResponse<T> {
  data: T;
  meta?: PaginationMeta;
  request_id: string;
}

export interface ApiFieldError {
  field: string;
  code: string;
  message?: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  field_errors?: ApiFieldError[];
  details?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
  request_id: string;
}