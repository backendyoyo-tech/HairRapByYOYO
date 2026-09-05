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