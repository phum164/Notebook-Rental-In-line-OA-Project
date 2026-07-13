# Deployment smoke tests

Use synthetic accounts and records only. Run against the explicitly verified target environment. Do not log response bodies, cookies, tokens, signed URLs, object paths, or PII.

## Read-only baseline

- Health/root route responds with expected release version and no sensitive headers/body.
- Public laptop catalog loads; a soft-deleted/unavailable item is not offered incorrectly.
- Unauthenticated customer/admin requests receive the contracted denial.
- A customer cannot access another customer's rental; role substitution is denied.

## Critical synthetic flow

- Server-verified customer session succeeds with the environment's test LINE configuration; a forged client `line_user_id` is rejected.
- Customer DB JWT uses the expected issuer and active `kid`; both keys work only during a planned overlap, an unknown/retired `kid` fails, and the request path does not use service-role credentials.
- Quote uses integer satang and inclusive Bangkok calendar dates.
- Booking retry with the same idempotency key does not duplicate; overlapping booking conflicts safely.
- Private upload rejects invalid MIME/size and never returns a permanent public URL.
- Admin access obeys role/MFA gates; invalid state transitions fail without mutation.
- Notification/webhook test validates signature/replay behavior and does not duplicate an outbox event.

## Operational checks

- Correlation appears across request/job events with redaction intact.
- Alert test reaches the intended staging route without sensitive payload.
- Database, storage, bandwidth, function, build, LINE, and log quotas have headroom.
- Rollback owner, incident channel, backup reference, and forward-fix notes are available.

Any failed auth, privacy, booking, money, migration, audit, or idempotency check blocks promotion and is returned to the owning agent.
