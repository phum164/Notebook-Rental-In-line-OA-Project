# Contract Changelog

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
