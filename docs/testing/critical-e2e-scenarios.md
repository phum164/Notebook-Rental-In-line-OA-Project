# Critical E2E and Boundary Scenario Catalog

These scenarios are implementation-neutral acceptance scripts. They must run against an isolated staging environment with synthetic identities and generated images. No production PII, signed URL, token, or raw webhook body may enter traces/screenshots.

## `E2E-CRIT-01` — Complete rental lifecycle

Preconditions: clean deterministic seed; one AVAILABLE laptop; Customer A and B; active REVIEWER, OPERATIONS and OWNER admins with `aal2`; current contract/payment settings; synthetic CLEAN image generator; controllable clock; LINE test adapter/outbox capture.

1. Anonymous browses active catalog; retired laptop and private fields are absent.
2. Customer A completes server-verified LINE bootstrap. Forged `line_user_id` in any request is ignored/rejected.
3. Customer A selects equal start/end date, receives a 1-day integer-satang quote, then creates booking with an idempotency key. Rental becomes `PENDING_PAYMENT` and holds inventory atomically.
4. Customer B attempts an overlapping endpoint range for the same laptop and receives conflict; no second hold/rental side effect.
5. Customer A views current contract, records immutable acceptance, creates/finalizes KYC and slip intents with generated valid images, and submits payment. Identical retries return the original outcome.
6. Rental reaches `PENDING_REVIEW`; outbox event exists only after the committed transition. Customer B cannot read rental/evidence.
7. Viewer cannot read signed KYC/slip. Reviewer obtains a one-object ≤60-second signed read, verifies evidence/payment, and approves with current `If-Match`; stale version and repeated changed-body key fail safely.
8. Operations starts preparation, uploads/finalizes BEFORE_RENT evidence, marks ready, and hands over. Rental/laptop become `ACTIVE`/`RENTED`; skipping inspection is denied.
9. Customer A sees own Bangkok-rendered timeline and requests return. Operations receives return, records AFTER_RETURN evidence and an itemized no-damage disposition.
10. Operations requests the permitted refund with recent MFA. Parallel identical retries create one obligation; worker retry produces one settlement.
11. Financial settlement completes rental. Laptop becomes AVAILABLE (or MAINTENANCE only if disposition requires it); rental becomes `COMPLETED`; audit/status/contract/evidence history remains append-only.
12. Notification retries produce one internal effect per unique event; logs/traces contain no token, subject, PII, object key, image metadata, or signed URL.

Pass oracle: every named state/side effect matches frozen contract, critical negative assertions deny, and database aggregates reconcile. Any identity/private-storage/financial duplication bypass is Critical.

## Customer/API scenarios

| ID | Scenario | Expected result |
|---|---|---|
| `E2E-CUST-01` | Catalog pagination/filter/detail including retired record | Only active sanitized public data; stable cursor; retired hidden |
| `E2E-CUST-02` | Quote/booking with overlap and expired quote/hold | Server totals; exactly one hold; deterministic conflict/expiry cleanup |
| `E2E-CUST-03` | Current contract replaced after quote, tampered hash, retry | Acceptance pins exact displayed immutable version; tamper/stale mismatch denies |
| `E2E-CUST-04` | KYC/slip upload interrupted, retried, spoofed | Valid retry safe; invalid bytes/quota/cross-target deny; private after finalize |
| `E2E-CUST-05` | Own timeline vs Customer B rental | Own timeline only; cross-owner hidden without existence oracle |
| `E2E-CUST-06` | UTC instant around Bangkok midnight/month/year rollover | UI displays correct Bangkok date/time consistently |

## Admin scenarios

| ID | Scenario | Expected result |
|---|---|---|
| `E2E-ADM-01` | Operations create/update/retire laptop; Viewer/Reviewer try same | Authorized commands audited/soft-delete; adjacent roles deny |
| `E2E-ADM-02` | Reviewer KYC/payment review, stale version, Viewer/Operations signed read | Only scoped Reviewer/Owner with `aal2`; stale/role/case deny |
| `E2E-ADM-03` | BEFORE_RENT inspection and handover | Append-only evidence required before ready/active |
| `E2E-ADM-04` | AFTER_RETURN inspection with correction | Eligible state only; correction supersedes; original immutable |
| `E2E-ADM-05` | Refund with expired recent MFA and parallel retry | Step-up required; one obligation/settlement; audit complete |
| `E2E-ADM-06` | Owner settings/contract publish; other roles attempt | Owner/recent MFA only; immutable version/hash; secret fields absent |
| `E2E-ADM-07` | Admin timeline/report near Bangkok rollover | UTC persistence and Bangkok display agree with customer view |

## State and validation negatives

- Attempt every skipped rental transition: direct ACTIVE, direct COMPLETED, approve without evidence, ready without BEFORE_RENT, finalize without AFTER_RETURN/fee disposition, return/refund in wrong state.
- Attempt arbitrary `status`, role, owner/customer/laptop, price/total, verification actor/time, object key/purpose, audit metadata and contract hash mass assignment.
- Missing/invalid `Idempotency-Key`; same key with different canonical body; missing/stale `If-Match`; extra unknown JSON fields; malformed UUID/date/time; oversized strings/arrays; wrong content type.
- Try edits/deletes on verified payment, completed refund, finalized evidence, condition log, contract acceptance/version, status history and audit event.

## Manual mobile and accessibility run

For each critical customer step, run 320×568 and 390×844 plus one real iOS and Android LIFF/WebView. For admin critical review/refund, run desktop keyboard-only and 768px reflow. Record only synthetic UI artifacts.

Acceptance includes: no horizontal loss at 320px/200% zoom; visible and logical focus; keyboard completion; labeled inputs/buttons; errors associated and announced; async status announced without focus theft; dialogs trap/restore focus; Thai text does not clip; touch targets usable; non-color status cues; reduced motion; contrast; upload/session/network recovery. Automated accessibility findings never replace keyboard and screen-reader smoke.

## Execution record template

| Field | Value |
|---|---|
| Scenario/test IDs | |
| Environment/build/migrations | |
| Synthetic seed/run ID | |
| Browser/device/viewport | |
| Command/manual procedure | |
| Expected / actual | |
| Result and UTC time | pass / fail / blocked |
| Sanitized artifact | |
| Defect/limitation | |

