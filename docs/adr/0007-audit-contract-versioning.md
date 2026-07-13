# ADR-0007: Append-only audit and immutable contract acceptance

- Status: Accepted baseline; legal content/retention approval pending
- Date: 2026-07-13

Critical commands append actor type/id, action, target, UTC time, request/idempotency correlation, prior/new status and outcome. Audit excludes secret/token/signed URL/raw identity image data. Corrections are new events, not edits.

Published contracts are immutable versions with content snapshot and SHA-256 hash. Acceptance records rental, customer/provider subject, contract version/hash, accepted UTC time and request context. A boolean alone is insufficient. Legal must approve wording, lawful basis and retention before production PII.
