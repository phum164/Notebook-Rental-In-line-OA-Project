# Staging validation —2026-10-30

## Verified boundaries

- Vercel isolated Hobby project notebook-rental-staging; branch codex/staging. [Manual deployment](https://vercel.com/phum164s-projects/notebook-rental-staging/5VGbxMMBirNdgkwBgAUrfZBQNPfz) of bd4e8b3f5318b1602d9e0b6d2f07a2e4e15fbdbd is Ready44s after [CI40939805185](https://github.com/phum164/Notebook-Rental-In-line-OA-Project/actions/runs/40939805185) succeeded.
- Actual logs: Node22.x overrides empty-project26.x, pnpm11.7.0 via Corepack, frozen lockfile, Next16.4.1, build/deployment complete. Exact Vercel Node patch is not established by these logs.
- [Primary alias](https://project-to50t.vercel.app/) responds200 HTML with nonce CSP/nosniff; /admin also has DENY framing. /api/v1/admin/auth/session and /api/v1/admin/rentals deny401 with private/no-store. Worker endpoint fails closed503 without its configuration. Immutable deployment URL is Vercel-login protected; protection was not disabled.
- Existing signed-in Chrome customer tab renders the app with an unconnected/configuration error and missing LINE contact. This is not a successful customer flow.

## Authorized Supabase installation

Owner confirmed project vnsyzmaoqcetrnzulylv is staging-only/no real data and authorized001–006/seed, then specifically007 after preflight found pgcrypto in extensions rather than public. Original001–006 are unchanged.007 replaces only the contract SHA-256 expression with the PostgreSQL built-in; signature/ACL/OWNER/recent-MFA/idempotency/search path remain intact.

Actual PostgreSQL17.6/UTC baseline was empty: no public app tables/enums/functions, buckets, custom app roles or migration-history table. Migrations001–007 committed in order between07:08:34Z and07:10:39Z; pinned seed committed07:12:34Z. No reset/deletion/compatibility bootstrap/provider call was used.003/004 warned about inability to revoke btree_gist extension-function privileges; application capability checks and suites passed without modifying extension ownership.

Postflight:29 tables all RLS enabled+forced; five custom roles NOLOGIN/NOSUPERUSER/NOBYPASSRLS; one reservation exclusion; shifted timestamp defaults0. laptop-public is the only public bucket; four evidence/quarantine buckets are private, object count0. Anonymous contract publish and outbox direct customer reads are denied.

All12 rollback-only SQL suites passed on the actual staging database: foundation, overlap, RPC boundary, RLS access/storage/storage-intent, LINE receipts, critical workflow, UTC instant, timezone boundary, upload recovery and contract-hash portability. Read-only integrity checks also pass. Final seed-only counts: customers2/laptops2/quotes1/rental DRAFT1; reservation/idempotency/audit/history/outbox0. Direct SQL claims tests are not JWT-signature/PostgREST/Auth/Storage-HTTP proof, and serial overlap is not a new two-connection race test.

001–007 were explicitly applied through psql with per-file checksum checks and ON_ERROR_STOP. This route does not automatically maintain Supabase CLI migration history: reconcile that history before using db push; never blindly replay the non-idempotent baseline. Exact manifest and operation receipts are retained in the local A00 staging handoff.007 SHA256:80A4D748058FEDB93F75A3C4F96DD12C208DA7BD1BCCEA64D5BA7CF1A9B2C912.

## Remaining acceptance / security gates

- Local connection file is Git/Vercel ignored; no password is a command-line argument or printed. Client-to-pooler TLS verify-full succeeds using the CA linked by Supabase Dashboard, without global trust changes. Backend pg_stat_ssl reports false: upstream pooler-to-database transport remains a release gate, not end-to-end TLS proof. [Official certificate/psql guidance](https://supabase.com/docs/guides/database/psql).
- Vercel has no app runtime credentials; imported signing-key trust, issuer/audience, independent sessions/worker secrets and admin OAuth/TOTP/role mapping are not configured/accepted.
- No actual LINE send, LIFF endpoint/webhook change, scanner approval, retention/legal policy, real PII, backup007 recovery, alerts or owner production sign-off. Notifications remain disabled. The overall project is not complete or ready for business production.
