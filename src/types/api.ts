import type { IsoDateTime } from "./domain";

export type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "INVALID_TRANSITION"
  | "IDEMPOTENCY_CONFLICT"
  | "RATE_LIMITED"
  | "UPLOAD_REJECTED"
  | "INTERNAL_ERROR";

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  requestId: string;
  details?: ReadonlyArray<{ field?: string; reason: string }>;
}

export interface ErrorResponse {
  error: ApiError;
}

export interface CursorPage<T> {
  data: T[];
  page: {
    nextCursor: string | null;
    hasMore: boolean;
  };
  meta: {
    requestId: string;
    generatedAt: IsoDateTime;
  };
}

export interface MutationMeta {
  requestId: string;
  idempotencyKey?: string;
}
