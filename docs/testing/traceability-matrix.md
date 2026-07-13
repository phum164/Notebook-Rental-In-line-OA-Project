# SRD → Acceptance → Test → Owner Traceability

Status: Wave 1 baseline. Evidence state values are `static-verified`, `planned-blocked`, `passed`, or `failed`; only commands actually executed may move a row to `passed`.

| Req ID / SRD capability | Testable acceptance | Test IDs | Implementation owner | QA method / evidence state |
|---|---|---|---|---|
| `SRD-C01` Browse laptops/spec/price | Anonymous/customer sees active non-retired laptops, public sanitized images, specs, integer-THB rate/deposit; unavailable/retired private details do not leak; pagination stable | `API-CAT-01..05`, `E2E-CUST-01`, `SEC-RLS-01` | A01/A02/A03 | Contract + UI/unit review now; API/E2E/RLS `planned-blocked` |
| `SRD-C02` Calculate rental | Authenticated quote uses server price snapshot, inclusive Bangkok dates, minimum 1 day, no overlap, integer satang totals, expiry enforced | `MONEY-01..08`, `TIME-01..10`, `API-QUOTE-01..08` | A01/A02/A03 | Static contract/fixture verified; live API/DB `planned-blocked` |
| `SRD-C03` Booking + KYC | Verified LINE session creates one atomic hold; ignores client identity/price; own KYC intent/finalize only; invalid, cross-user, duplicate, overlap and malicious uploads deny | `SEC-AUTH-01..10`, `CONC-BOOK-01..02`, `IDEM-BOOK-01..02`, `SEC-UP-01..18`, `E2E-CUST-02` | A01/A02/A03/A05 | Design + SQL scripts exist; live API/Storage/race `planned-blocked` |
| `SRD-C04` Contract agreement | Current published immutable version/content/hash shown; acceptance pins rental/customer/version/hash/time/request context; false/stale/tampered/cross-user acceptance denied | `API-CONTRACT-01..07`, `IDEM-CONTRACT-01`, `E2E-CUST-03` | A01/A02/A03 | Contract/schema static review; runtime `planned-blocked` |
| `SRD-C05` QR + payment slip | Customer sees allowlisted payment instructions; own valid slip can finalize/submit; server obligation wins; retries do not duplicate; evidence remains private | `API-PAY-01..09`, `IDEM-PAY-01`, `SEC-STO-01..16`, `E2E-CUST-04` | A01/A02/A03/A05 | Contract/policy static review; runtime `planned-blocked` |
| `SRD-C06` Track own rental/contact LINE OA | Customer sees only own status/timeline and contact link; other rental is hidden (404/no oracle); status is server-controlled and Bangkok-rendered | `API-TRACK-01..06`, `SEC-RLS-02`, `TIME-08..10`, `E2E-CUST-05` | A01/A02/A03 | UI/unit available; integrated auth/RLS `planned-blocked` |
| `SRD-A01` Inventory management | Operations/Owner create/update/retire with strict schema, integer price, `If-Match`, idempotency, audit, soft delete; Viewer/Reviewer/customer deny; no conflicting retire/maintenance | `API-INV-01..12`, `SEC-RBAC-01..05`, `IDEM-INV-01`, `E2E-ADM-01` | A01/A02/A04 | Mock/UI review now; API/RLS `planned-blocked` |
| `SRD-A02` Rental/KYC/payment review | Reviewer/Owner with active `aal2` can view scoped 60s KYC/slip and approve/reject under guards; Viewer/Operations/cross-case/stale version deny; decision audited | `SEC-RBAC-06..14`, `SEC-STO-06..16`, `API-REVIEW-01..12`, `E2E-ADM-02` | A01/A02/A04/A05 | Design/migration static review; integrated `planned-blocked` |
| `SRD-A03` Before/after condition | Operations/Owner finalize append-only stage evidence only in PREPARING/INSPECTION_PENDING; required notes/images; wrong role/stage/case and overwrite deny; condition media admin-only | `API-COND-01..12`, `SEC-STO-10..16`, `STATE-01..08`, `E2E-ADM-03..04` | A01/A02/A04/A05 | Contract/schema static review; runtime `planned-blocked` |
| `SRD-A04` Deposit refund/fees | Itemized integer obligations follow inspection disposition; recent MFA; unique refund obligation/idempotent attempts; no duplicate settlement; completion waits resolved finances | `MONEY-06..08`, `IDEM-REF-01`, `API-REF-01..12`, `STATE-09..14`, `E2E-ADM-05` | A01/A02/A04 | Formula policy blocked by D-07; structural/runtime tests `planned-blocked` |
| `SRD-A05` Settings/contracts/QR/messages | Owner-only versioned updates/publish with recent MFA, strict keys, immutable contract hash/audit; public/customer projection excludes secrets; role and stale-version negatives | `API-SET-01..09`, `API-CONTRACT-08..12`, `SEC-RBAC-15..20`, `E2E-ADM-06` | A01/A02/A04 | Contract/mock review now; integrated `planned-blocked` |
| `SRD-P01` LINE notifications | Event is inserted post-domain transaction in same commit; verified webhook raw bytes are deduped durably; retries bounded/idempotent/redacted; invalid signature/body rejects | `SEC-LINE-01..14`, `IDEM-LINE-01`, `RES-LINE-01..04`, `E2E-LINE-01` | A01/A02/A05/A07 | Design only; D-13 + integration `planned-blocked` |
| `SRD-P02` Timezone | All instants persist/transport UTC; rental dates are Bangkok civil inclusive; customer/admin display Asia/Bangkok at day/month/year/leap boundaries | `TIME-01..10`, `E2E-CUST-06`, `E2E-ADM-07` | A01/A02/A03/A04 | Adapter unit evidence available; full DB/UI `planned-blocked` |
| `SRD-P03` Soft delete/history | Retiring laptop preserves rental/history/FKs; hard delete and mutation of append-only state/audit/contract/final evidence deny | `DB-HIST-01..08`, `SEC-RLS-10..14` | A01/A02/A04 | Static migration tests available; live SQL `planned-blocked` |
| `SRD-P04` PDPA/private KYC | Restricted data is default-deny/private, minimal, no permanent URL/log/fixture; notice/lawful basis/retention approved before production; DSAR/breach flows work on synthetic data | `SEC-STO-01..16`, `SEC-LOG-01..08`, `PRIV-01..14` | Legal/Owner + A01/A02/A05/A07 | Design gate present; approvals/integration `planned-blocked` |
| `SRD-P05` Money type | All prices/amounts are non-negative integer satang within max and THB; no arbitrary float computation; reconciliation deterministic | `MONEY-01..08`, `DB-MONEY-01..05` | A01/A02/A03/A04 | Static schema/adapter evidence available; live full flow `planned-blocked` |

## Cross-cutting contract acceptance

| Contract concern | Acceptance | Test IDs | Owner | Wave 1 evidence |
|---|---|---|---|---|
| Standard errors/input | Mutation rejects unknown fields; 401/403/404/409/422 semantics and request ID do not leak sensitive detail | `API-ERR-01..10`, `SEC-HTTP-01..06` | A02 | OpenAPI lint/static only |
| Named state transitions | Actor, guard, state, evidence, version, side effect and invalid paths match frozen state machine | `STATE-01..14` | A01/A02/A04 | Static contract/schema mapping only |
| Session separation | Customer/admin cookies and token principals are not substitutable; revocation/expiry enforced | `SEC-AUTH-06..10`, `SEC-RBAC-18..20` | A01/A02/A05 | Design only |
| Accessibility/mobile | Critical customer/admin flows meet mobile/reflow and manual WCAG baseline without sensitive artifacts | `UX-MOB-01..10`, `A11Y-01..16` | A03/A04 | Planned for integrated UI |
| Reliability/operations | Isolated env, migration/reset, alert/redaction, backup/restore, quota/degradation and smoke evidence are reproducible | `RES-01..12`, `PRIV-10..14` | A07 | Runbooks only; execution blocked |

## Evidence update rule

For every executed ID, A06 records environment/build, seed/run ID, command or manual procedure, expected/actual result, timestamp, sanitized artifact location, and defect ID if failed. Rows remain `planned-blocked` until that evidence exists; a passing owner unit test does not replace independent RLS/concurrency/E2E evidence.

