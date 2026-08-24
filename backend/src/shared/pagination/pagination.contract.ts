export type SortOrder = "asc" | "desc";

export interface PaginationQuery {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder: SortOrder;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  sortBy?: string;
  sortOrder?: SortOrder;
}