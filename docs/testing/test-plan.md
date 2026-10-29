# A06 Risk-Based Test Plan

Status: **Wave 4 local execution update** (2026-10-29). Independent composed HTTP tests pass with provider transport injected. A01 separately executed PostgreSQL17 SQL lifecycle/RLS/race/recovery checks. Current scoped results are in `traceability-matrix.md` and `../agent-plan/handoffs/A06-wave4.md`; this is not staging/production acceptance.

## Objectives and quality gates

The independent QA gate proves that the SRD workflow works end to end and that unauthorized principals cannot cross customer, role, state, money, or private-object boundaries. Evidence is linked through `docs/testing/traceability-matrix.md` and scenario IDs in `docs/testing/critical-e2e-scenarios.md`.

| Gate | Exit rule | Current evidence state |
|---|---|---|
| Contract/test design | Every SRD row maps to acceptance, test IDs, owner, and evidence | Ready for static verification |
| Slice gate | Happy, validation, unauthorized, conflict/retry, and invalid-transition tests pass for each handed-off API slice | Local composed adapters/router/persistence pass; provider transport injected |
| Data/security gate | Clean reset/seed, SQL constraints, RLS/Storage allow+deny, JOSE gateway negatives, and true overlap race pass | A01 local PostgreSQL17 SQL/race pass;006 actual UTC/upload-recovery regressions pass; live JOSE/Storage transport not run |
| Critical E2E | `E2E-CRIT-01` passes in isolated staging with synthetic data | Local transport and separate SQL lifecycle pass; one full-stack browser/staging journey not run |
| Release quality | Critical suite 100%; no unresolved Critical/High defects; mobile/a11y/money/time gates pass | No unresolved local high defect after namespace fix; browser/mobile/a11y/providers/approvals still required |

No static source assertion may be reported as proof of live SQL syntax, RLS enforcement, Storage policy behavior, JWT signature verification, concurrency, scanner behavior, or provider delivery.

## Risk model and priorities

Priority combines impact and likelihood. P0 tests block the first integrated slice and every release candidate; P1 blocks the related vertical slice; P2 is required before final release unless A00 accepts a time-boxed documented exception.

| Risk | Priority | Required coverage | Primary owner(s) | Independent evidence |
|---|---:|---|---|---|
| Forged LINE identity, cookie/JWT substitution, IDOR | P0 | Provider negatives, customer ownership, session-kind and DB-JWT claim/key tests | A02/A05/A07 | A06 `SEC-AUTH-*`, `SEC-RLS-*` |
| Public/enumerable KYC, slip, or condition evidence | P0 | Bucket privacy, list/read/write/overwrite/delete denial, scoped signed read ≤60s | A01/A02/A05 | A06 `SEC-STO-*` |
| Double booking | P0 | Inclusive-boundary overlap plus two-session concurrent commit | A01/A02 | A06 `CONC-BOOK-*` |
| Duplicate payment/refund/notification/finalize | P0 | Same-key replay, changed-hash conflict, concurrent retry, post-commit delivery | A01/A02/A05 | A06 `IDEM-*` |
| Unauthorized admin mutation or sensitive read | P0 | Role adjacency, inactive account, `aal1`, stale MFA, self-escalation | A01/A02/A04 | A06 `SEC-RBAC-*` |
| Client-controlled price/status/owner/evidence purpose | P0 | Strict schema, server recomputation, named commands, immutable snapshots | A01/A02 | A06 `API-TAMPER-*` |
| Malicious/spoofed upload or quota exhaustion | P1 | MIME/magic mismatch, malformed/polyglot, dimensions, count, scanner fail-closed, cleanup | A02/A05/A07 | A06 `SEC-UP-*` |
| Money/date/timezone mismatch | P1 | Integer bounds, inclusive dates, quote snapshots, UTC/Bangkok rollover | A01–A04 | A06 `MONEY-*`, `TIME-*` |
| Missing contract/privacy evidence or excess retention | P1 | Immutable hash/version, separate notice evidence, legal hold, purge/restore tombstone | A01/A02/A05/A07 | A06 `PRIV-*` |
| Webhook forgery/replay and notification ordering | P1 | Exact raw bytes/HMAC, dedupe, durable receipt, outbox after commit, retries | A02/A05 | A06 `SEC-LINE-*` |
| Mobile LIFF/admin accessibility failure | P1 | Target viewports, keyboard/focus, labels, errors, contrast, reflow, screen reader smoke | A03/A04 | A06 `UX-*`, `A11Y-*` |
| Logs/errors/fixtures leak secrets or PII | P1 | Redaction snapshots, repository scan, synthetic-only evidence | A02/A05/A07 | A06 `SEC-LOG-*` |
| Quota/outage/degraded dependency | P2 | Bounded failure, recovery/retry, alert, no unsafe bypass | A05/A07 | A06 `RES-*` |

## Test layers and execution order

1. **Static contract and fixture checks:** OpenAPI lint, TypeScript, scenario/fixture invariants, no obvious secrets/PII. Runnable in Wave 1.
2. **Unit/component:** owner suites for quote/state/input/policy/UI adapters; A06 reviews gaps but does not edit owner source.
3. **API/DB integration:** isolated database reset, seed, API route execution, SQL constraint/RLS/Storage scripts, JWT gateway negatives.
4. **Browser E2E:** real customer/admin routes with provider adapters in staging; synthetic objects only.
5. **Concurrency/retry:** independent workers/transactions with synchronized barriers, never sequential requests presented as a race test.
6. **Operational/manual:** mobile LIFF devices, screen reader, scanner/provider outage, retention/backup/incident rehearsals.

Each slice handoff must state environment, immutable build/commit identifier when available, migration set, seed version, commands, timestamps, result artifact, and limitations. Failures become reproducible defect handoffs to the file owner; A06 never patches production/schema/shared contract.

## Functional and boundary coverage

### Money

- Accept integer satang only; reject decimals, floats, negative, NaN/infinity strings, unsafe/coerced values, and values above `99,999,999,999`.
- Recompute `rentalSubtotal = dailyRateSatang × inclusiveDays` and `totalDue = subtotal + deposit` server-side; client totals never win.
- Verify immutable quote/rental snapshots across later laptop price changes and retries.
- Test 0, 1, maximum permitted value, multiplication/addition overflow handling, and THB-only responses.
- Fee/refund formula assertions remain blocked by D-07; test only itemization, approval, caps/invariants, compensating rows, and idempotency until Finance approves the formula.

### Dates, instants, and timezone

- `startDate=endDate` is one rental day; adjacent ranges sharing an endpoint overlap because both endpoints are inclusive.
- Reject end-before-start, malformed dates, impossible dates, timestamp-in-date fields, and expired quotes/holds at exact boundary.
- Persist instants as RFC 3339 UTC and render in `Asia/Bangkok`, including `16:59:59Z→23:59:59`, `17:00:00Z→next day 00:00`, month/year/leap-day rollover.
- Do not import DST assumptions from other zones; Bangkok remains UTC+7.

### Concurrency and idempotency

| ID | Operation | Concurrent/retry oracle |
|---|---|---|
| `CONC-BOOK-01` | Two customers book overlapping inclusive dates for one laptop | Exactly one commit; loser receives conflict / SQLSTATE `23P01`; no orphan hold |
| `CONC-BOOK-02` | Expiry worker races payment/review | One valid terminal outcome under lock/state guard; inventory matches durable rental state |
| `IDEM-BOOK-01` | Repeated booking key, identical body | Original response/one rental/one hold |
| `IDEM-BOOK-02` | Same key, different canonical body | `409 IDEMPOTENCY_CONFLICT`; no second mutation |
| `IDEM-PAY-01` | Parallel payment submit/finalize retry | One evidence consumption and one payment attempt per intended operation |
| `IDEM-REF-01` | Parallel refund request/worker retry | One obligation; attempts may repeat safely; settlement amount never duplicates |
| `IDEM-LINE-01` | Duplicate webhook/outbox lease recovery | One durable receipt/internal effect; bounded provider ambiguity is surfaced, not hidden |

### Upload and private evidence

Run allow cases for valid synthetic JPEG/PNG/WebP within limits and deny cases for extension/MIME/magic mismatch, executable/archive/document signatures, malformed/truncated images, active polyglot/trailing data, dimension/pixel bomb, oversize/zero byte, count overflow, wrong purpose/target/prefix, expired/consumed intent, cross-user/cross-case access, overwrite/upsert/move/copy/delete/list, quarantine read, scanner outage, and orphan cleanup. Verify EXIF/GPS removal after re-encoding. Sensitive URLs must be single-object, ≤60 seconds, `private, no-store`, absent from logs/cache/history/fixtures.

### Accessibility and mobile

- Customer LIFF: 320×568, 360×800, 390×844, 430×932 CSS pixels; iOS and Android LIFF/WebView smoke; safe areas, keyboard overlay, back/reload/session recovery, slow network, upload interruption, Thai text expansion.
- Admin: 1280×720 primary plus 768×1024/reflow; keyboard-only review, inventory, inspection, refund and settings workflows.
- Automated checks are a baseline only. Manual WCAG 2.2 AA-oriented review covers logical headings/landmarks, visible focus, focus order/restoration, labels/instructions, error association/summary, status announcements, dialogs, non-color cues, touch targets, zoom/reflow, contrast, alt text, and reduced motion.
- No sensitive image or signed URL may be captured in screenshots or automated traces; use generated non-PII test images.

## Security and privacy execution matrix

Detailed cases are in `docs/testing/security-negative-plan.md`. Minimum release evidence includes:

- LINE bootstrap: forged/expired/wrong channel or issuer, missing subject, nonce replay, provider outage.
- Customer DB JWT: wrong/missing/unknown/retired `kid`, invalid signature, `alg=none`/confusion, wrong issuer/audience/type, malformed sub, future `nbf`, expired/overlong token, clock skew, browser/log/cache absence.
- Admin: role adjacency, inactive membership, `aal1`, stale recent MFA, role change/revocation, customer/admin session substitution.
- RLS/Storage: anonymous and cross-owner deny, positive least-privilege cells, append-only immutability, worker scope, private bucket/list/read/write negatives.
- HTTP: strict inputs, CSRF/origin/CORS, headers/cache, rate limits without existence oracle, XSS payload rendering, error redaction.
- LINE/webhook: raw-byte HMAC before parse, body limit, replay receipt, post-commit outbox, retry/dead letter.
- Privacy: notice/contract separation, retention/legal hold, DSAR cross-account/export redaction, purge partial failure, restored-backup tombstone, breach key/session rotation.

## Environments, fixtures, and data handling

- Use dedicated dev/staging Supabase, Storage, LINE test channel, secrets, and callbacks. Preview/dev must not reach production.
- Seed only deterministic synthetic identifiers and generated images. Never copy real KYC, slip, LINE profile, address, phone, signed URL, webhook payload, token, or secret.
- The canonical QA fixture catalog is `tests/fixtures/synthetic-fixtures.json`; binary image payloads must be generated during the test and discarded.
- Clock-dependent tests use an injected/frozen clock or explicit setup timestamps; no arbitrary sleeps.
- Clean state before each destructive/concurrency suite and isolate parallel workers by run ID.

## Defect workflow

Severity: Critical = identity/RLS/private-data/financial integrity bypass or release-wide loss; High = critical workflow unavailable or exploitable role/state/idempotency gap; Medium = bounded functional/accessibility failure with workaround; Low = cosmetic/documentation issue.

A defect handoff records owner/path, build/environment, synthetic preconditions, exact steps/commands, expected vs actual, request/correlation IDs only, sanitized artifact, reproducibility, severity rationale, and affected test IDs. A06 sends it to A01–A05/A07 by ownership and reruns the smallest failing layer plus impacted regression after the owner fix. Critical/High defects cannot be waived by QA; A00 owns exception/change governance.

## Current environment limitations

- A06 local composed HTTP tests and A01 PostgreSQL17 compatibility SQL/RLS/intent, two-connection overlap and local database backup/restore have executed; attribution and exact scope are in the current traceability/handoffs.
- Actual `supabase db reset` on the target PostgreSQL15 gateway, JOSE signature/rotation negatives, Storage HTTP allow/deny/expiry, browser/mobile/a11y lifecycle, approved scanner, LINE delivery, retention operations and deployed recovery remain **not run** by A06.
- A00 attempted a local browser server launch, but tool approval failed from reviewer capacity/deadline before the server command executed. This is a tool/environment limitation, not an observed app/browser failure. No browser pass or screenshot is claimed.
- D-07, D-09/D-10, D-13, D-15/D-16 and related approvals remain release gates; planned tests do not imply policy approval.

