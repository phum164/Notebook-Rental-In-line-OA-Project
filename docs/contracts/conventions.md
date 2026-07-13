# Shared Contract Conventions

## HTTP and payloads

- Base path `/api/v1`; JSON uses `camelCase`; database naming is A01-owned `snake_case`.
- Resource IDs are UUID strings. Dates are `YYYY-MM-DD`; instants are RFC 3339 UTC strings ending in `Z`.
- Money fields use integer satang and suffix `Satang`; currency is always `THB` in MVP.
- Collections use cursor pagination: `limit` (default 20, max 100), opaque `cursor`, and `{data,page,meta}`.
- Errors always use `{error:{code,message,requestId,details?}}`; clients branch on `code`, not message.
- Unknown input fields are rejected for mutations. The server validates path/query/body and authorization.

## Authentication

- Customer endpoints use the server-issued customer session cookie. Admin endpoints use the separate admin session cookie.
- `401 AUTH_REQUIRED` means missing/invalid session; `403 FORBIDDEN` means authenticated but not permitted.
- Mutations require same-origin/CSRF controls. Browser clients do not pass `lineUserId`, role or computed price as authority.

## Mutation and retry rules

- `Idempotency-Key` is mandatory for booking, payment submission/review, refund, notification-triggering commands and upload finalization. Format: 16–128 URL-safe characters.
- The persistence key is scoped by principal + operation + target. Reuse with a different canonical request hash returns `409 IDEMPOTENCY_CONFLICT`; identical reuse returns the original outcome.
- Version-sensitive admin commands use `If-Match`/resource version and return `409 CONFLICT` on stale state.
- `422 INVALID_TRANSITION` includes current status and allowed command names but no sensitive data.

## Upload protocol

1. Client requests an upload intent with purpose, target resource, filename, declared MIME and size.
2. Server authorizes target/purpose and returns one short-lived, single-object signed upload operation plus `uploadId`; it never returns broad bucket credentials.
3. Client uploads bytes directly. The server finalizes by checking object ownership, size, magic bytes and policy, then records an opaque evidence ID.
4. Consumers request an authorized 60-second signed read URL when needed. URLs and object keys must not be logged or cached publicly.

Baseline allowlist pending A05 validation: JPEG/PNG/WebP; 10 MiB each; KYC max 2, slip max 3, each condition stage max 12. EXIF is stripped before durable use; suspicious content is quarantined. These are safe assumptions with owner/expiry in the decision register.

## Change governance

Breaking means removing/renaming a field/status/error, changing meaning/type/auth, or tightening a previously valid transition without versioning. A00 records every contract change in `docs/contracts/CHANGELOG.md`; schema changes additionally require A01 migration notes. Downstream owners acknowledge changes in handoffs before integration.
