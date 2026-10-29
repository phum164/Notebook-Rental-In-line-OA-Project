# Contract Changelog

## 2026-10-26 — Critical workflow completion

- Added the accepted completion contract in `docs/agent-plan/handoffs/A00-critical-workflow-completion.md` for maintenance/product images, request-return, immutable financial disposition, exact manual refund confirmation and customer public contact settings.
- Closed unsafe absent-refund settlement and cross-key refund over-allocation requirements; A01/A02 implement and A06 verifies the full rental lifecycle.
- Patched release dependencies to Next.js 16.4.1, matching ESLint config, Zod 4.6.6 and patched transitive PostCSS/Browserslist/source-map-js based on registry audit evidence.

## 2026-10-26 — Wave 3 auth and LINE durability batch

- Resolved CR-A04-01 with additive `startAdminLogin` and `completeAdminLogin` PKCE redirect operations; no password endpoint or client role input was added.
- Accepted CR-A05-02 for an A01-owned metadata-only LINE receipt ledger plus scoped persist/claim/complete RPCs; verified events remain fail-closed until A01/A02/A05 consume it.
- Accepted the technical part of CR-A05-03 by adding the exact LINE recipient to the existing scoped outbox claim projection. D-13 event/template/recipient policy remains an Owner/Ops release gate and runtime rendering stays fail-closed.
- Consumers requiring changes: A01 implements roles/table/RPCs, A02 implements admin callback and scoped adapters, A05 wires the receipt and approved renderer, and A07 configures redirect allowlists, secrets and workers.

## 2026-08-30 — CR-A02-01 additive remediation

- Added `createLineBootstrap`, the sole server-issued five-minute single-use LINE nonce flow bound by an opaque HttpOnly browser cookie.
- Added independent `verifyRentalKyc`, `rejectRentalKyc`, `verifyRentalPayment`, and `rejectRentalPayment` admin commands with exact evidence/payment targets, idempotency, rental-version guards, and review-specific errors.
- Made `approveRental` a pure guarded transition: it returns `INVALID_TRANSITION` until current KYC and payment decisions are independently verified.
- Assigned bootstrap/resolve/revoke to a 60-second scoped `app_session_service` JWT/NOLOGIN role with execute-only RPC grants and no table, RLS-bypass, or service-role privilege.
- Consumers requiring changes: A01 migration/RPC/model and A02 router/persistence/validators/tests; A03 consumes only `createLineBootstrap` before LIFF session creation.

## 2026-07-13 — v1 Wave 0 freeze

- Established integer-satang money and Bangkok inclusive calendar-date rules.
- Added role/session boundaries, named state commands, standard errors, cursor pagination and idempotency behavior.
- Added private upload-intent/finalization flow and short-lived signed reads.
- Added delivery/inspection/refund states required by the SRD workflow.
- Initial consumers notified through Wave 1 task dispatch: A01, A03, A04, A05, A06 and A07.
- Before UI mock dispatch, added explicit current-contract/payment-settings, admin inventory, inspection, secure evidence-read, settings and contract-publish operations; clarified customer-only endpoint security.
- Resolved CR-A05-01: opaque customer sessions map server-side to short-lived asymmetric database JWTs so normal Supabase access remains RLS-enforced without secret/service-role bypass.
- Resolved CR-A07-02 at the root toolchain: override transitive PostCSS to patched `8.5.10` for GHSA-qx2v-qp2m-jg93; lockfile/audit verification required.
- Accepted Next.js-generated `.next/dev/types` include and moved `typedRoutes` to its stable top-level Next 16 configuration after Wave 1 shell build.
- Resolved A04 mock review gaps with additive admin session, rental detail/allowed-command, inspection/history/audit reads and itemized fee-disposition operations before A02 integration.
