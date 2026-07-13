# Threat Model and Risk Register — Wave 1

Scope: LINE LIFF customer authentication, admin authentication, Next.js APIs, PostgreSQL/RLS, Supabase Storage, LINE webhook/notifications, logs/audit, and retention jobs. This is a design review; implementation evidence begins after A01/A02 handoffs.

## Assets and trust boundaries

Critical assets are customer identity bindings, opaque sessions, admin sessions/MFA state, KYC images, payment slips, condition evidence, delivery/contact data, money/state commands, contract acceptance, audit history, LINE channel credentials, storage signing credentials, webhook receipts, and notification outbox events.

| Boundary | Entry | Security decision | Failure signal |
|---|---|---|---|
| LINE/LIFF → session bootstrap | Provider credential + nonce | Verify server-side; expected channel/audience, issuer where applicable, subject, expiry, nonce; issue a separate opaque session | Auth rejection count by reason code, no token value |
| Customer browser → API | Session cookie/body | CSRF/origin, input schema, ownership, rate limit, command/state guard | 401/403/409/422 metrics by route family |
| Admin browser → API | Supabase Auth session | Separate cookie, active role from DB, `aal2`, recent-MFA gate for high risk | MFA downgrade, forbidden mutation, role change/revocation |
| Browser → Storage | Upload/read request | One-object expiring intent or authorized signed read; no broad credentials | Intent rejection/quarantine/signed-read issuance count |
| API → PostgreSQL | Verified command | Least-privilege DB identity, RLS, transaction/constraints, audit, idempotency | RLS denial, conflict/retry, invariant violation |
| LINE → webhook | Raw body + signature | HMAC verification before parse, body limit, durable dedupe receipt | Invalid signature, duplicate event, processing lag |
| API/worker → LINE | Outbox | Post-commit claim, idempotency, bounded retry/backoff, minimal PII | Retry/dead-letter age, status class, no raw payload |
| Retention worker → data/storage | Scheduled job | Approved schedule, legal-hold check, manifest, two-phase purge, audit | Backlog age, purge failures, hold skips |

## STRIDE analysis

| ID | Category / scenario | Impact | Required controls | Verification owner |
|---|---|---|---|---|
| T01 | Spoofing: submitted `line_user_id` or forged/expired/wrong-channel LINE credential | Critical account takeover/IDOR | Ignore client ID; validate credential and nonce server-side; bind immutable provider subject; rotate session | A05 design, A02 implementation, A06 negative |
| T02 | Spoofing: customer/admin cookie substitution | Critical privilege escalation | Separate cookie names/issuers/audiences/route middleware; discriminated server session; reject mismatched kind | A02/A06 |
| T03 | Spoofing: stolen admin password or stale privileged session | High sensitive access/refund abuse | MFA `aal2`; recent MFA ≤15m for refund/role/settings/secret changes; idle/absolute expiry; revoke on disable/role change | A02/A04/A06 |
| T04 | Tampering: client changes role, price, owner, status, evidence purpose | Critical financial/state corruption | Server derivation, strict schemas, named commands, RLS, state guards, immutable price snapshot, audit | A01/A02/A06 |
| T05 | Tampering: webhook body/signature altered or parsed first | High forged events | Capture exact raw UTF-8 bytes; HMAC-SHA256 with channel secret; constant-time compare; reject before parse | A05/A06 |
| T06 | Tampering: overwrite/swapped object after validation | Critical false KYC/payment evidence | Random immutable key; deny upsert/update/move; finalize atomically records detected hash/size/MIME; consume intent once | A01/A02/A05/A06 |
| T07 | Repudiation: admin denies verification/refund/role action | High dispute/compliance failure | Append-only actor/action/target/result/UTC/correlation/prior-new status; contract/version hash; no mutable audit | A01/A02/A06 |
| T08 | Information disclosure: public or enumerable sensitive media | Critical PII exposure | Separate private buckets, default deny/list deny, 60s one-object signed reads, no URL/key logs, authorization at issuance | A01/A05/A06 |
| T09 | Information disclosure: excessive admin access or API fields | High PDPA breach | Role/case scope, response projections, column allowlists, audit sensitive reads, Viewer media deny | A01/A02/A04/A06 |
| T10 | Information disclosure: token/PII in logs, telemetry, errors, fixtures | High credential/privacy breach | Structured allowlist logging, field redaction, generic errors, synthetic fixtures, secret scanning | A05/A07/A06 |
| T11 | Denial of service: upload bombs, storage quota exhaustion | High outage/cost | Request/body limits, 10 MiB/file, per-purpose counts, per-principal/IP throttles, magic-byte/dimension checks, orphan cleanup, quota alerts | A02/A05/A07/A06 |
| T12 | Denial of service: webhook floods/retries | Medium notification lag | Verify before costly parse, body/rate limits, durable dedupe, bounded queue concurrency, retry/backoff/dead letter | A05/A07/A06 |
| T13 | Elevation: service-role key used by browser/ordinary API | Critical RLS bypass | Server-only secret, never client bundle; ordinary customer requests use publishable key + per-request short-lived DB JWT; service worker separated and least privilege | A00/A01/A02/A05 |
| T14 | Elevation: forged/substituted DB JWT | Critical RLS bypass | Server-only asymmetric minting after opaque-session validation; fixed `iss`/`aud`; allowlisted algorithm/current `kid`; ≤5m expiry; `principal_type` separation; adversarial tests | A00/A01/A02/A06 |
| T15 | Replay: booking/payment/refund/finalize/notification repeats | High duplicate charge/state/message | Principal+operation+target idempotency key and canonical request hash; unique receipts; atomic original response | A01/A02/A05/A06 |
| T16 | Privacy: indefinite PII/backups/orphans | High regulatory/customer harm | Approved retention schedule, legal hold, orphan TTL, purge manifest, backup expiry tracking, DSAR/deletion workflow | Legal/Owner, A05/A07 |
| T17 | Supply-chain/secret compromise | High broad compromise | Exact lockfile, CI scanning, separated environment secrets, rotation/revocation runbook, no preview-prod trust | A07/A05 |

## Risk register and release treatment

| Risk | Inherent | Wave 1 treatment | Residual / gate |
|---|---:|---|---|
| Customer identity impersonation/IDOR | Critical | Frozen server verification/session/ownership design | High until negative tests pass |
| Public sensitive evidence | Critical | Private/default-deny matrix and signed-read design | High until migration + live storage tests pass |
| Ordinary service-role bypass / forged customer DB token | Critical | CR-A05-01 resolved to server-only asymmetric JWT with fixed claims and ≤5m expiry | High until issuer/audience/key-rotation and substitution tests pass |
| Admin account takeover | High | MFA/role/session design | Owner/Security approval + staging enforcement required |
| Malicious/spoofed upload | High | Validation/quarantine/lifecycle design | Scanner implementation capability and tests pending |
| Excess retention/unlawful PII | High | Draft schedule/runbooks and hard production gate | **Legal/Owner approval required before production PII** |
| Duplicate notification/refund effects | High | Durable outbox/idempotency/replay design | Implementation/concurrency tests pending |
| Provider/storage outage or quota | Medium | Bounded retry, monitoring, cleanup, environment isolation | A07 SLO/quota/DR design pending |

## Security acceptance test inventory

- Forged, expired, wrong-channel/audience, wrong issuer where applicable, nonce replay, missing subject, and provider outage cases for customer bootstrap.
- Anonymous, cross-customer, wrong-admin-role, inactive admin, `aal1`, stale recent-MFA, and session-kind substitution tests.
- Invalid/missing webhook signature, changed raw bytes, wrong secret, duplicate event, oversized body, and retry ordering tests.
- Public/list/cross-case sensitive object denial; wrong MIME/magic byte, polyglot/oversize/dimension bomb, excess count, expired/consumed intent, overwrite, orphan, quarantine, and retention cases.
- Log/trace/error snapshots prove absence of credentials, LINE subject, object key, signed URL, raw PII, and image metadata.

## Review cadence

Re-review at A01 policy handoff, each A02 vertical-slice handoff, storage/LINE integration, pre-staging, after any provider/auth/storage contract change, and after a security incident. A05 owns risk updates; A00 accepts architecture changes; A06 independently verifies controls.
