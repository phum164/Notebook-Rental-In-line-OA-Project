# Security, Privacy, and Resilience Negative Test Plan

Status: test inventory ready; live execution blocked on integrated slices and isolated Supabase/LINE/Storage environment.

## Authentication, session, and JWT

| IDs | Negative set | Oracle |
|---|---|---|
| `SEC-AUTH-01..05` | Forged/expired/wrong-channel or audience/wrong issuer/missing subject LINE credential; provider unavailable | 401/controlled failure, no decoded-claim fallback, no session/customer mutation, redacted metric only |
| `SEC-AUTH-06..10` | Reused/mismatched nonce; customer/admin cookie substitution; both cookies; expired/revoked/disabled session; token in URL/local storage | Fail closed for route principal; cookie deleted/rotated as required; no credential exposure |
| `SEC-JWT-01..14` | Missing/wrong/unknown/retired `kid`; invalid signature; `alg=none`/confusion; wrong iss/aud/role/principal type; malformed/non-UUID sub; future nbf/iat; expired/overlong exp/skew; admin/customer substitution | Gateway rejects before Data API; no private row; server DB JWT never reaches browser/log/cache/persistence |

## RBAC, RLS, and immutability

| IDs | Negative set | Oracle |
|---|---|---|
| `SEC-RBAC-01..20` | Every role attempts adjacent/higher capability; inactive membership; editable JWT metadata role; `aal1`; stale recent MFA; self-role grant; role change with old session | 403/no mutation; active DB membership + `aal2`; recent MFA where required; revocation immediate; audited deny/success without PII |
| `SEC-RLS-01..09` | Anonymous/cross-customer list/select/insert/update/delete for customer, rental, payment, evidence, condition, contract acceptance | No row/deny without existence oracle; own minimal positive cells still work |
| `SEC-RLS-10..14` | Owner/worker modifies/deletes audit, status, acceptance, finalized evidence/payment; worker accesses domain/media outside lease | Append-only constraints/policies deny; worker remains purpose/target-scoped |

## Storage and uploads

| IDs | Negative set | Oracle |
|---|---|---|
| `SEC-STO-01..05` | Public/list/prefix enumeration; direct anonymous/customer read; wrong bucket/path; cross-user/cross-case | Private buckets disclose nothing; product derivatives only public |
| `SEC-STO-06..09` | Viewer/wrong role signed read; quarantined/deleted/not-ready object; TTL >60s; response cache/log/history | Deny or single-object ≤60s URL with no-store; URL/key absent from persistence and observability |
| `SEC-STO-10..16` | Expired/consumed intent; wrong actor/target/purpose/MIME/size/key; overwrite/upsert/move/copy/delete; object swapped after validation | Deny; one immutable object/evidence hash; intent consumed atomically |
| `SEC-UP-01..18` | Zero/oversize/count overflow; extension/MIME/magic mismatch; truncated/malformed/polyglot/executable/archive/document; dimension/pixel/decode bomb; EXIF/GPS; scanner unavailable; orphan/quarantine lifecycle | Bounded rejection or quarantine; production scanner fail closed; metadata stripped; cleanup idempotent and legal-hold aware |

## HTTP/application abuse

| IDs | Negative set | Oracle |
|---|---|---|
| `SEC-HTTP-01..06` | Missing/wrong Origin/Host/CSRF; wildcard credential CORS; unexpected content type; oversized body; sensitive caching/framing/header weakness | Mutation denied; bounded parse; no-store/security headers; explicit origins only |
| `API-TAMPER-01..10` | Client identity/role/price/status/owner/evidence purpose/reviewer/time/hash; unknown fields; prototype-like keys; mass assignment | Strict 422/403; server-derived values unchanged; no side effect |
| `SEC-XSS-01..08` | HTML/script/event/SVG/URL payloads in name/spec/notes/reason/settings/contract/filename | Stored/reflected content encoded/sanitized by context; CSP blocks execution; no unsafe link/navigation |
| `SEC-RATE-01..06` | Auth/upload/signed-read/privileged/webhook floods and cross-account existence probes | Bounded 429/degradation, equalized non-disclosure, legitimate recovery, redacted alert |

## Webhook, notifications, and retries

| IDs | Negative set | Oracle |
|---|---|---|
| `SEC-LINE-01..07` | Missing/invalid/wrong-env signature; changed whitespace/raw bytes; oversized body; malformed JSON after valid signature; unsupported event | Verify exact raw bytes before parse; reject/durable-ack as designed; no raw-body log |
| `SEC-LINE-08..14` | Duplicate event; crash after receipt; business rollback; worker crash/lease expiry; 429/5xx/network timeout; permanent 4xx; poison event | One receipt/internal effect; no pre-commit send; bounded backoff/dead letter; ambiguity visible; credentials/payload redacted |

## Privacy, DSAR, retention, and logging

| IDs | Negative set | Oracle |
|---|---|---|
| `SEC-LOG-01..08` | Token/cookie/LINE subject, PII/contact, object key/filename, signed URL, webhook/raw body, QR/payment/image metadata in errors/logs/traces/screenshots/fixtures | Allowlist fields only; scans/snapshots find none; request/correlation IDs remain usable |
| `PRIV-01..05` | Missing notice/lawful basis/retention approval; bundled consent; contract checkbox used as consent; excessive KYC fields/OCR; free-text PII | Production collection blocked; separate immutable evidence; minimized schema/API; validation/warning/redaction |
| `PRIV-06..10` | Cross-account DSAR; weak lost-account verification; third-party data in export; unauthorized admin export; expired export link/repeat | Deny or step-up/four-eyes; subject-only redacted export; short-lived delivery; audited idempotent request |
| `PRIV-11..14` | Legal hold, partial object deletion, purge retry, restored backup without tombstone | Hold prevents purge/read as policy; manifest/retry safe; restored data re-purged before service reopens |

## Concurrency, money, time, and availability

Use synchronized barriers/independent sessions for `CONC-BOOK-*` and parallel idempotency tests from `test-plan.md`. Also inject failures before/after transaction commit, evidence finalize, receipt insert, outbox claim, provider call, and settlement confirmation. The invariant is reconciliation among rental state, reservation, financial obligation/attempt, evidence status, audit, and outbox—not merely an HTTP status.

Money and time generators cover safe bounds, multiplication/addition overflow, negative/coerced/decimal input, one-day/leap/month/year dates, inclusive shared endpoints, quote/hold expiration at exact instant, and Bangkok midnight conversion. Use a frozen clock; arbitrary sleep is not acceptable evidence.

## Required live commands/procedures (not run)

```text
supabase db reset
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/database/foundation.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/database/overlap.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/rls/access.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/rls/storage.sql
two independent psql sessions: tests/database/overlap-concurrency.md
gateway/browser/API suites: to be bound to A02–A05 handoff commands without creating QA-owned config
```

Expected first integration report must say these are `not run` until the environment actually exists; static migration tests are not substitutes.

