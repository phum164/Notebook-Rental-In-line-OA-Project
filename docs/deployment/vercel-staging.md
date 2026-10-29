# NotebookRental — Vercel staging preparation

Status2026-10-30: user selected Vercel and logged in manually. Dashboard shows `phum164's projects` (`phum164s-projects`), Hobby, no existing project. No Vercel project/deployment/domain/environment value has been created or changed yet.

## Target and source boundary

- Intended new project name: `notebook-rental-staging` (proposed until confirmed available). Separate staging project only; no production promotion or paid-plan selection.
- Source repository already configured locally: `phum164/Notebook-Rental-In-line-OA-Project`.
- Existing local HEAD: `a40c3ff` (`fix: allow required pnpm dependency builds`); current accepted runtime/migrations/UI/security work is dirty/untracked, not contained merely by that commit. Importing the current GitHub snapshot does not prove deploying the reviewed candidate.
- User explicitly authorized scoped commit/push to new `codex/staging` on2026-10-30. Preserve `main`, unrelated changes and ignored agent handoffs; never stage `.env`/credentials. Review exact staged diff and redacted secret-scan results before commit/push. The CI workflow now also triggers on this branch so no PR or main push is needed merely to run hosted checks.
- GitHub app installation/repository access or new credentials require action-time confirmation. Do not grant access to every repository by default or automate authentication dialogs.

## Build settings to verify in the actual project

| Setting | Intended value / gate |
|---|---|
| Framework | Next.js |
| Root directory | repository root |
| Install | pinned `pnpm@11.7.0`, frozen lockfile, retaining `pnpm-workspace.yaml` overrides/lifecycle allowlist |
| Build | `pnpm build`; no static export/output-directory override |
| Node |22.x to align major with CI; Vercel manages minor/patch, so it is not proof of exact CI22.14.0 |
| Package-manager selection | Verify Corepack/packageManager support in target; set only documented build configuration, never accept an incidental different pnpm silently |
| Environment | isolated staging project/Preview scope; no imported production secret collection |
| Protection | inspect actual Deployment Protection; do not disable it or create bypass tokens without approval. LIFF cannot silently bypass Vercel login protection |
| Scheduler | none installed; `LINE_NOTIFICATIONS_ENABLED=false` until D-13/provider acceptance |

Vercel supports major Node versions and rolls minor/patch updates; current package engine `>=22.14.0` alone does not pin the platform to22.x. See [Node settings](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [build configuration](https://vercel.com/docs/builds/configure-a-build) and [environment scopes](https://vercel.com/docs/environment-variables).

## Configuration ordering

1. Confirm source candidate and target account/project before creation. Inspect inherited/team environment configuration by names/scope without printing values.
2. Select the actual HTTPS staging origin after project/domain identity exists; do not invent a URL or change LIFF to an unverified hostname.
3. Authorize the Supabase target explicitly: visible project `Notebook Rental Project`/`vnsyzmaoqcetrnzulylv` is not yet classified/approved as staging. Never migrate merely because that dashboard is open or labels its branch PRODUCTION.
4. Configure public app/Supabase/LIFF values and server secrets privately in the protected target. LINE Login2010763298/LIFF2010763298-y0LKglvP is distinct from user-selected BrownBot Messaging API2007538833. Do not copy the whole local `.env`.
5. Admin OAuth provider, exact callbacks/TOTP/admin role mapping, imported public signing-key trust/issuer/audience and independent session/scheduler secrets remain to be provisioned/verified. No ordinary-request service-role shortcut.
6. Keep notifications disabled, no production data collection or uploads while approved scanner/retention/legal gates are incomplete. Do not label an HTML shell deploy as critical-flow acceptance.
7. Verify target preflight, immutable source/hosted CI, remote migrations001–006 only under explicit target approval, then deploy and inspect actual build/runtime logs without secret/PII output. Rehearse synthetic critical browser/LIFF/Storage/OAuth/rollback/provider flows before acceptance.

## Upload boundary

`.vercelignore` excludes local env/auth/link files, private-key formats, Git/agent metadata, dependencies/build/cache/log/dump artifacts for source uploads. `.vercel/` is also Git-ignored. This is a preventive filename boundary, not a full secret scanner or proof of what a browser folder picker uploads. Do not upload the unfiltered workspace through a folder picker; do not assume ignore rules revoke an already committed secret. Verify the actual upload/commit manifest before transmission. The [official ignore documentation](https://vercel.com/docs/deployments/vercel-ignore) describes Vercel exclusions.

## Acceptance evidence still missing

Project ID/name/account, exact deployed source commit/manifest, branch/environment, generated HTTPS origin, actual Node/pnpm versions, env preflight, hosted CI/build/log/HTTP/browser results, provider/DB/Storage/scanner trust, rollback/recovery and required owners/sign-offs. No completion or production readiness follows from this preparation note.
