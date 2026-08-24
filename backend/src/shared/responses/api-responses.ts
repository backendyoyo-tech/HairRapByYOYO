import type {
  ApiSuccessResponse,
} from "../contracts/index.js";
import { PaginationMeta } from "../pagination/index.js";

export function successResponse<T>(
  data: T,
  requestId: string,
  meta?: PaginationMeta,
): ApiSuccessResponse<T> {
  return {
    data,
    ...(meta ? { meta } : {}),
    request_id: requestId,
  };
}