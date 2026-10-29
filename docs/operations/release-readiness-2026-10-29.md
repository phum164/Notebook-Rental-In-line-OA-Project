# Release readiness — 2026-10-29

Decision: **NO-GO for staging acceptance and production release**. Local implementation/rehearsal evidence is available; external environment, provider, security and owner approvals are not. This report does not authorize any deploy, migration, notification, transfer or production PII collection.

## Follow-up — 2026-10-30

The earlier one-moderate audit snapshot below is superseded by `A00-dependency-audit-2026-10-30.md`: Next's vulnerable baseline-browser-mapping2.10.43 was replaced with the already cached2.11.32 through an exact override. Offline frozen install, actual Next-resolution invalid-input/valid-lookup self-check and a new production build passed; production audit now reports zero advisories at all severities in this registry snapshot. The earlier200 application tests were not rerun/relabelled as this patch's full regression. The user also selected BrownBot/Messaging API2007538833 for NotebookRental; Login/LIFF remains2010763298. No secret, webhook, send, staging deployment or D-13 event/recipient approval follows from this target choice. All unrelated release gates remain NO-GO.

## Candidate and evidence boundary

- Candidate: workspace package `notebook-rental@0.1.0`; dirty/untracked multi-agent work, no immutable release commit/artifact or hosted CI run attached. No commit/push was requested or performed by A07.
- Application: Next `16.4.1`, React `19.2.7`, Zod `4.6.6`; reviewed transitive overrides are in `pnpm-workspace.yaml`. CI pins Node `22.14.0`/pnpm `11.7.0`; A00 final central run used bundled Node `24.22.1`/pnpm `11.25.0`. The earlier A07 shell reported Node `22.23.4`; neither local run proves the exact hosted pins.
- A00 central frozen install, lint/typecheck/OpenAPI, 23 Vitest files/200 tests, production build and production dependency audit-high all passed (exit0). Audit still reports one moderate advisory. OpenAPI has four documented redirect/public-response warnings, no errors. These are local results, not hosted CI or interactive browser acceptance.
- A01 handoff proves clean migrations001–005 + seed, eight SQL suites, full named-RPC rental-to-settlement flow, true two-connection booking race and same-cluster dump/restore. See `A01-critical-workflow-completion.md` and `backup-restore.md` for limits.
- A01 confirmed a real -25200-second timestamp defect under Bangkok sessions and expired-upload capacity exhaustion, then corrected them with forward migration006. Clean001–006 + seed, eleven SQL suites and restore invariants pass; independent UTC/Bangkok/New York regression and actual Bangkok INSERT/UPDATE now have zero offset. See `A01-qa-timezone-fix.md`. Historical timestamps were not rewritten. The earlier race/dump-restore remains snapshot005 evidence; no006 dump/restore rehearsal is claimed.
- A02/A03/A04 focused evidence is in their critical-workflow handoffs; A05 durable ingress is in `A05-durability-wiring.md`. A06 accepted 20 independent local tests, and A00 recorded scoped local conformance in `A00-local-conformance-2026-10-29.md`. Live and unimplemented requirements remain open.

## Environment preflight (names/status only)

`pnpm env:check` exited 1 on this workstation. No value was printed or changed. Required remediation is by the named environment operator in the protected staging project, then independently verified:

| Variable/configuration | Current local finding | Required evidence / owner |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Invalid for HTTPS admin-cookie requirements | Exact approved HTTPS app origin/domain/TLS; DevOps + Owner |
| `SUPABASE_AUTH_PROVIDER` | Missing | Enabled approved provider identifier, tenant/access policy and exact provider/Supabase callback allowlists; Identity admin |
| `CUSTOMER_DB_JWT_PRIVATE_KEY` | Invalid PEM/signing material | Managed RSA/P-256 EC/Ed25519 private key matching imported trusted public key/`kid`; Security + DevOps; never send the key in chat |
| `CUSTOMER_DB_JWT_ISSUER`, `CUSTOMER_DB_JWT_AUDIENCE` | Missing | Exact environment-specific values and gateway acceptance/negative tests; A00/A05 + Supabase operator |
| `CRON_SECRET` | Missing | Independent server scheduler bearer secret of at least 32 characters and protected job configuration; DevOps |
| Other configured fields | Presence only, not validity/trust | Correct isolated Supabase URL/public key, session signing secret, LINE channel/secret/LIFF ID; verify in provider consoles without exposing values |

The current runtime reads `NEXT_PUBLIC_SUPABASE_URL` and public-key aliases. Unused `.env.example` aliases are not fallback authority. `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_SECRET_KEY` are not a way to repair scoped runtime authorization. `LINE_PRIVATE_KEY`/`SUPABASE_JWKS_URL` do not substitute for the implemented signer/provider configuration.

## Release blockers and action packet

| Gate | Exact facts/approval needed | Owner / acceptance evidence |
|---|---|---|
| D-16 environment identity | Separate Vercel/Supabase/Storage/LINE dev/staging/prod project and channel IDs, app domains, account ownership, named deploy/rollback operators; preview inherits none of their secrets | Owner + DevOps; signed non-secret environment register and explicit target approval |
| Auth/IdP/TOTP | Approved IdP/provider + redirect to Supabase Auth callback; Supabase redirect allowlist for `https://<app>/api/v1/admin/auth/callback` with generated state query; enrolled verified TOTP, enabled admin mapping and required roles | Identity admin + A02/A06/A07; real HTTPS login → aal1 pending → challenge → aal2 session, CSRF/expiry/replay/disabled-role denial; no recovery shortcut |
| Supabase gateway/RLS/Storage | Exact project database version, final A01 migration manifest001–006, imported public verification keys/custom scoped service roles and origin/CORS policy; reject invalid JOSE/signature/claim and cross-principal access | Supabase operator + A01/A05/A06; local UTC/non-UTC regression passed; actual PostgREST/JWT/Storage allow/deny tests remain required |
| Production upload scanner | Approved malware scanning/sanitization adapter with exact bounded MIME/magic/decode/EXIF/quarantine behavior; authenticated scanner-to-RPC grant boundary | Security + A05/A02; current production runtime fails finalization closed (`allowBasicUploadScan=false`); a variable alone does not supply a scanner; test clean/malicious/unavailable and no read before READY |
| D-13 notifications | Signed approver/date/reference, exact event allowlist/text/recipient/fallback/retry/consent decisions and backlog policy | Owner + Ops; provision policy privately, synthetic test on isolated channel and actual scheduler execution. JSON syntax/approvalReference text is not business approval |
| Legal/privacy/finance/product | D-01/03/04/05/06/07/08/09/10/11/12/14/17/18 decisions still need applicable owner sign-off, including contract/notice, lawful basis, retention/legal hold, fee/refund policy and operational manual-transfer controls | Product + Owner + Finance + Legal; dated decision records; engineering baselines with expired due dates are not approval |
| D-15 recovery/SLO/quota | Hosting plan/scheduler frequency/max-duration compatibility, SLO/support hours, RTO/RPO, backup/PITR/object retention capability and paid-plan limits | Owner + DevOps; encrypted database+private-object restore into isolated authorized recovery target, measured recovery/loss, alert delivery and quota headroom |
| HTTP controls | A00 implemented fresh per-request script nonce/strict-dynamic CSP, dynamic uncached HTML, nosniff/no-referrer/narrow Permissions-Policy and admin framing denial; local production HTTP checks passed | A00 + A05/A06; actual browser hydration, LIFF scripts, private Storage and QR origins still require acceptance. Dynamic rendering changes caching/load costs. HSTS waits for HTTPS domain/subdomain sign-off |
| QA, artifact and CI | A06 final critical QA/no unresolved high defect, A00 conformance; pinned locked-install/verify/build/audit/secret-scan hosted jobs on exact candidate | A06 + A00 + repository owner; branch-protection evidence, immutable artifact/version, action resolved SHAs. Prior moderate advisory fixed locally on10-30; actual hosted candidate scan remains required |
| Staging rehearsal | Explicitly approved target, migrations/backward-compatible app, synthetic critical flow including reload-safe booking/TOTP/private media/return/exact manual refund, rollback/forward-fix | A07 + A01/A06 + Owner; measured timestamps and redacted evidence. App rollback must retain schema compatibility; never destructive down migration |

## Scheduler and secret boundaries checked

- `/api/internal/line` is dynamic Node, maximum 60 seconds, GET with exact bearer authentication. Missing/short secret yields 503, wrong bearer 401; generic failures and aggregate results use private/no-store. Tests are centrally consolidated by A00.
- No `vercel.json` schedule or other production scheduler was installed. Provisioning frequency requires hosting-plan and D-15 approval. Prevent overlapping external triggers; database fenced claims remain the retry boundary.
- Keep `LINE_NOTIFICATIONS_ENABLED=false` until D-13 acceptance; invalid/missing policy or token causes no outbound claims/provider sends. Once enabled, an unapproved event makes no provider call but can consume retry attempts, so review/backlog-map every produced event before activation. A valid policy does not prove the recipient is authorized or the message delivered/read.
- Inbound metadata-only receipts are finalized IGNORED: no subscribed chat automation is implemented. Worker scheduling does not create a chat business workflow.
- Evidence orphan/quarantine/retention deletion remains disabled pending approved scanner/deletion boundary, legal hold and retention policy. Do not add a cleanup cron as a workaround.
- `.env`, `.env.*` are ignored except `.env.example`; `git ls-files -- .env '.env.*'` returned only `.env.example`. This is an index/ignore check, not a full secret-scan pass. Existing local secrets were neither printed nor changed.
- CI uses no application/deploy secret, no privileged fork event, no deploy/CD. The scanner has read-only token and disabled comments/artifact upload; organization licensing and fork access remain owner setup gates.

## Migration identity snapshot

Recomputed by A00 after the006 handoff; any subsequent change invalidates this snapshot. Clean001–006 execution passed; snapshot005 race/dump-restore evidence is explicitly separate. No remote migration was applied.

| Migration | SHA256 |
|---|---|
| `202607130001_foundation.sql` | `D433B49DCE4BD75B7F84D1B932959005AC7A307CF930318A4DF24A71A5130DBE` |
| `202607130002_rls_and_storage.sql` | `F80FF4764F830228F6CE3E46E7D37046312FE5A9B0FB9A54AD1B4804A6C3A5A2` |
| `202608300003_cr_a02_01_rpc_boundary.sql` | `D222FEB27D0ED3A457316065B9B3E08A09E025991BDA8D86242298ADC5973C7F` |
| `202610260004_line_receipt_rpc.sql` | `290AEE2E3AF533132D515F828A20D9A8106C6A3FDAE88C758FA411B900BB3BE5` |
| `202610260005_critical_workflow_completion.sql` | `4CA29A493CF4F8D29F0716E5FBEA741C7C3198F362183B4F4F716BD2E450579F` |
| `202610290006_qa_time_and_upload_recovery.sql` | `B9C1CF89B74C0D695C3A8E577C1FBF373A49720F50F927045305D6C8167D3F8E` |

## A00 production HTTP smoke (local only)

Using the built Next server on loopback port3100: `/admin` returned200; its eleven executable HTML script tags all carried the response nonce; the next response had a different nonce. Admin frame-ancestors none/X-Frame-Options DENY, nosniff, no-referrer and private/no-store passed. Anonymous admin session and customer rentals endpoints returned401. Customer HTML returned200 with strict-dynamic. No browser JavaScript, LIFF login, OAuth, real upload or provider operation was executed by these fetches. Interactive browser acceptance remains not run. The temporary server was stopped; a later listener check found neither3100 nor the A01 test PostgreSQL port55439 listening.

`AUTO_REPLY_TEXT` is settings CRUD only: an inbound automatic-reply consumer is absent. D-13 must settle trigger/recipient semantics before implementation/acceptance; this is remaining functionality, not merely a deployment variable.

## Stop conditions and next authority

Any environment mismatch, unresolved high defect, auth/private-object bypass, duplicate money/booking invariant, unavailable scanner, absent policy/legal approval or failed restore blocks promotion. Named Owner + Security/release approvers must authorize staging/deployment scope before A07 executes it. No production release operator/rollback owner/window is currently accepted in this report. A00 may accept the local engineering evidence without changing this external no-go decision.
