# Database data dictionary

Schema source baseline: migrations `202607130001`–`202610300007` (PostgreSQL 15+ / Supabase); applied target versions require separate deployment evidence.

## Cross-cutting rules

- IDs are UUIDs except append-only event identities (`bigint identity`).
- Monetary values use the `money_satang` domain: non-negative `bigint`, maximum `99,999,999,999`, currency fixed to `THB`. This remains below JavaScript's safe-integer limit.
- Instants use `timestamptz`; rental `start_date`/`end_date` are inclusive Bangkok civil `date` values. `rental_days = end_date - start_date + 1`.
- Instant defaults and update triggers use `statement_timestamp()` directly, independently of session `TimeZone`. Migration006 corrects 34 legacy zone-stripping defaults without rewriting historical rows; explicit Bangkok civil-date conversion is retained only where required by date semantics.
- Domain history uses `ON DELETE RESTRICT`; laptops retire through `status=RETIRED` plus `deleted_at`, never hard delete.
- RLS is enabled and forced on every application table. Missing/malformed identity returns no principal and therefore no private rows.
- Customer DB tokens must have the configured fixed issuer/audience, `role=authenticated`, `principal_type=customer`, a UUID `sub`, valid `iat`/`nbf`/`exp`, and lifetime at most five minutes. Admin access maps `auth.uid()` to an active database role and requires `aal2`; a customer token is explicitly rejected as admin.

## Core entities

| Table | Purpose and integrity |
|---|---|
| `customers` | Server-verified LINE subject mapping. `line_user_id` is unique; disabled rows cannot become an RLS customer principal. |
| `admin_users` | Supabase Auth user mapped to exactly one least-privilege role: Owner, Operations, Reviewer, or Viewer. |
| `laptops` | Inventory and immutable price basis. Catalog rows soft-delete only; status/deleted timestamp consistency is checked. |
| `laptop_images` | Sanitized public product-image object references, ordered per laptop. |
| `rental_quotes` | Expiring server quote with inclusive dates and checked rate/subtotal/deposit/total snapshots. |
| `rentals` | Rental aggregate, price/date snapshots, state, hold expiry, fulfillment and private delivery/return fields. |
| `rental_inventory_reservations` | Normalized blocking set with GiST exclusion over `(laptop_id, inclusive daterange)`. This is the concurrency arbiter. |
| `rental_status_history` | Append-only status evidence with actor, reason, request and UTC time. |

## Money, evidence and workflow

| Table | Purpose and integrity |
|---|---|
| `payments` | Immutable attempts by `(rental,type,attempt_number)`; evidence and verifier fields are required by status. |
| `fee_obligations` | Itemized integer-satang obligations; formula remains a future Finance decision. |
| `refunds`, `refund_attempts` | Idempotent refund obligation plus retry/settlement attempts; completed rows require evidence time. |
| `rental_financial_dispositions` | One immutable finalized AFTER_RETURN inspection, fee snapshot, deposit/refundable balance and exact refund obligation per rental. Fee changes freeze at disposition; no-fee and zero-refund outcomes are explicit. |
| `condition_logs`, `condition_log_evidence` | Before/after inspections; corrections supersede rather than overwrite. Evidence ordering limits a stage to 12 objects. |
| `evidence_objects` | Opaque private metadata. CHECK binds KYC→`kyc-private`, slips→`payments-private`, condition→`conditions-private`, product→`laptop-public`. No signed URL is stored. |
| `upload_intents` | Single evidence object, verified owner, expiry and one-time consumption marker. Storage INSERT policy must match it. |

## Contract, reliability and operations

| Table | Purpose and integrity |
|---|---|
| `contract_versions` | Append-only content snapshot and lowercase SHA-256 hash. Migration007 uses built-in `pg_catalog.sha256` over UTF-8 bytes for publication, independently of pgcrypto's schema. |
| `contract_acceptances` | One immutable acceptance per rental, pinned to customer/version/hash/time/request context. |
| `audit_events` | Append-only actor/action/target/outcome record. Raw PII, secrets, object keys and signed URLs are forbidden in metadata. |
| `idempotency_records` | Unique principal+operation+target+key and canonical SHA-256 request hash; repeated response can be persisted. |
| `notification_outbox` | Durable, uniquely keyed event delivery with claim/retry schedule. |
| `line_webhook_receipts` | Metadata-only verified-event inbox. Unique provider event ID plus payload SHA-256; duplicate metadata returns counts only, mismatched replay aborts atomically. Five attempts, two-minute fenced leases, delayed retry and terminal dead-letter. No message, profile, destination or raw body is stored. |
| `system_settings` | Versioned non-secret JSON setting. Direct authenticated reads exclude `value`; named API commands must enforce field allowlists. |
| `line_bootstrap_nonces`, `app_sessions` | Hash-only, short-lived LINE bootstrap and opaque customer sessions. Plain nonce/session/CSRF values never enter the database. |
| `kyc_submissions`, `kyc_submission_evidence`, `kyc_decisions` | Append-only KYC evidence sets and independent Reviewer/Owner decisions; rental approval only consumes their verified summary. |

## Named RPC boundary

Migration `202608300003` makes ordinary HTTP writes available only through named `SECURITY DEFINER` commands that pin `search_path`, validate the RLS-derived actor/role/version, and atomically write state, history, audit, idempotency and outbox records. `app_session_service` and `app_outbox_worker` are `NOLOGIN`/`NOBYPASSRLS` roles with no table or sequence access and execute-only allowlists. `app_upload_scanner` may read only the exact unconsumed `PENDING_UPLOAD` Storage object selected by its policy and cannot read application tables. The service role is not part of any normal request path.

Migration `202610260004` adds execute-only `app_line_webhook_ingress` (`line:webhook:persist`, at most 60 seconds) and `app_line_webhook_worker` (`line:webhook:process`, at most 300 seconds). Both have no application-table access. Persist/claim/complete are separate named RPCs; stale lease completion returns false. Outbox claim gains only `recipient_line_user_id` from its claimed row's enabled customer, preserving all existing fields. Service and customer identity validators reject missing/null/malformed required claims; provider admin identity requires an active mapping, `role=authenticated`, `aal2` and a safe UUID before any cast.

Migration `202610260005` adds return initiation, exact immutable financial disposition/manual refund confirmation, inventory maintenance and finalized product-image attachment. Recent MFA accepts only bounded signed `amr.method=totp` timestamps or the existing signed compatibility claim. Outbox expired leases are reclaimable with fresh fencing and at most five attempts. Public settings expose only an allowlisted LINE contact URL; payment instructions are shape-validated before storage.

The additive customer-owned `get_own_rental.completionSummary` resumes unfinished bookings: `kycReady` derives from the current non-rejected submission with READY owned evidence, `paymentStatus` is the latest rent/deposit attempt or `NOT_SUBMITTED`, `paymentEvidenceId` selects the latest owned READY unused slip, and `acceptedContract` is the exact immutable accepted version even after newer terms are published. No private object key, account details or signed URL is returned.

Migration `202610290006` also makes the existing per-rental KYC2/slip3 evidence cap count usable READY evidence or exact live unconsumed upload intents. Expired pending intents and terminal QUARANTINED/REJECTED evidence do not consume an active slot; previous KYC/payment review-rejection exclusions remain. Existing metadata and private bucket/intent restrictions are unchanged; no deletion or retention decision is introduced.

## Inventory overlap lifecycle

The reservation trigger adds a row for every blocking state from ADR-0003. `PENDING_PAYMENT` remains blocking until `expire_rental_holds()` durably changes the rental to `EXPIRED`; the same transaction removes its reservation. The job uses `FOR UPDATE SKIP LOCKED` for concurrent workers. Inserts racing for overlapping inclusive ranges serialize on the exclusion constraint, with at most one commit.

## Storage and access notes

- `laptop-public` is public and contains sanitized derivatives only.
- KYC, payment, condition and quarantine buckets are private. There is no public read policy.
- Sensitive object INSERT requires exact evidence bucket/key, exact purpose/bucket mapping, an unconsumed unexpired intent, and the allowed customer/admin principal.
- Sensitive object SELECT is limited to `READY` case evidence: Reviewer/Owner for KYC/slips and Operations/Owner for condition evidence. Customers cannot read submitted evidence objects.
- Physical purge, quarantine movement, retention/legal hold and worker-purpose grants remain server-only operational functions; no broad interactive service-role path is permitted.

## Generated TypeScript mapping

`src/types/database.generated.ts` maps `bigint money_satang` to `number` because the domain maximum (`1e11-1`) is a JavaScript safe integer. `date`, `timestamptz`, UUID and range values are serialized as strings. Regenerate after a local reset with `supabase gen types typescript --local` when the CLI is available.
