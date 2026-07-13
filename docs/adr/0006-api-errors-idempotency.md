# ADR-0006: REST commands, standard errors and durable idempotency

- Status: Accepted
- Date: 2026-07-13

The API is versioned at `/api/v1`, uses resource reads and named command mutations, cursor pagination and the shared error envelope. Arbitrary state-setting endpoints are forbidden. High-risk/retryable mutations require `Idempotency-Key`; the server stores principal, operation, target, canonical request hash and outcome under a unique constraint.

Same key/same request returns the original outcome; same key/different request returns `IDEMPOTENCY_CONFLICT`. Idempotency is not a substitute for authorization, state guards or database transactions.
