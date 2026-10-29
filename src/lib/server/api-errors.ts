import type { ApiErrorCode, ErrorResponse } from "@/types/api";

const statusByCode: Record<ApiErrorCode, number> = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  CONFLICT: 409,
  INVALID_TRANSITION: 422,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  UPLOAD_REJECTED: 422,
  INTERNAL_ERROR: 500,
};

export class ApiFailure extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: ErrorResponse["error"]["details"],
  ) {
    super(message);
  }
}

export function errorResponse(error: ApiFailure, requestId: string): Response {
  const body: ErrorResponse = {
    error: {
      code: error.code,
      message: error.message,
      requestId,
      ...(error.details ? { details: error.details } : {}),
    },
  };
  return Response.json(body, {
    status: statusByCode[error.code],
    headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId },
  });
}
