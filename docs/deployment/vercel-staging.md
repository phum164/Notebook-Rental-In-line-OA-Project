# NotebookRental — Vercel staging preparation

Status2026-10-30: isolated [notebook-rental-staging](https://vercel.com/phum164s-projects/notebook-rental-staging), project ID `prj_fatdcLXI2ahGzBCyiIrDy8IYXLy3`, account `phum164s-projects`, Hobby. Exact repository connected, codex/staging tracked. Manual app deployment of bd4e8b3 is Ready; [primary alias](https://project-to50t.vercel.app/) serves200 and protected admin APIs deny401. Logs verify Node22.x, pnpm11.7.0, Next16.4.1 and frozen install. Only non-sensitive Corepack flag is configured in Vercel; no app runtime credentials or provider changes. Separately approved Supabase staging now has001–007/seed and12 passing rollback-only SQL suites. This is bootstrap/schema evidence, not full application acceptance. See `staging-validation-2026-10-30.md`.

## Target and source boundary

- Confirmed project name: `notebook-rental-staging`. Separate staging project only; no business-production promotion or paid-plan selection. Vercel's built-in environment named Production belongs to this isolated staging project; its branch is codex/staging and it must contain staging-only values.
- Source repository already configured locally: `phum164/Notebook-Rental-In-line-OA-Project`.
- Historical main/base a40c3ff does not contain the accepted integrated candidate. Actual deployed application source is bd4e8b3 on codex/staging; subsequent database-only forward-fix/source documentation must not be mistaken for a new app deployment.
- User explicitly authorized scoped commit/push to new `codex/staging` on2026-10-30. Preserve `main`, unrelated changes and ignored agent handoffs; never stage `.env`/credentials. Review exact staged diff and redacted secret-scan results before commit/push. The CI workflow now also triggers on this branch so no PR or main push is needed merely to run hosted checks.
- GitHub app installation/repository access or new credentials require action-time confirmation. Do not grant access to every repository by default or automate authentication dialogs.

## Build settings to verify in the actual project

| Setting | Intended value / gate |
|---|---|
| Framework | Next.js |
| Root directory | repository root |
| Install | `pnpm@11.7.0` through `ENABLE_EXPERIMENTAL_COREPACK=1`, configured/verified in actual deployment logs; frozen lockfile via vercel.json, retaining `pnpm-workspace.yaml` overrides/allowBuilds |
| Build | vercel.json framework nextjs and `pnpm build`; no static export/output-directory override |
| Node |22.x to align major with CI; Vercel manages minor/patch, so it is not proof of exact CI22.14.0 |
| Package-manager selection | Verify Corepack/packageManager support in target; set only documented build configuration, never accept an incidental different pnpm silently |
| Environment | isolated staging project; its built-in Production/Preview labels are not business-production authority; no imported production secret collection |
| Protection | inspect actual Deployment Protection; do not disable it or create bypass tokens without approval. LIFF cannot silently bypass Vercel login protection |
| Scheduler | none installed; `LINE_NOTIFICATIONS_ENABLED=false` until D-13/provider acceptance |
| Git auto-deploy | disabled by vercel.json; deploy the exact CI-passed commit manually, not automatically on push |

Vercel supports major Node versions and rolls minor/patch updates. The actual empty-project UI defaulted to26.x; the source engine is now bounded `>=22.14.0 <23` so a broad lower bound cannot silently select that untested major. Source configuration overrides project framework/build and engine selection, but actual build logs must still prove Node/pnpm/source identity. See [Node settings](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [build configuration](https://vercel.com/docs/builds/configure-a-build), [environment scopes](https://vercel.com/docs/environment-variables) and [Git auto-deployment configuration](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled).

The initial import form could not unambiguously select a slash-containing branch: tree/codex/staging was rendered as branch codex + root staging, an encoded slash remained literal, and a commit URL fell back to main. No Deploy was clicked on those forms. Creating the empty project and setting branch tracking through Environment settings avoided changing GitHub's default branch or deploying the old main candidate.

## Configuration ordering

1. Confirm source candidate and target account/project before creation. Inspect inherited/team environment configuration by names/scope without printing values.
2. Select the actual HTTPS staging origin after project/domain identity exists; do not invent a URL or change LIFF to an unverified hostname.
3. Owner explicitly approved `Notebook Rental Project`/`vnsyzmaoqcetrnzulylv` as staging-only/no real data and001–007/seed; installation is complete. Do not rerun or reset it. No implied business-production authority follows from its branch label PRODUCTION.
4. Configure public app/Supabase/LIFF values and server secrets privately in the protected target. LINE Login2010763298/LIFF2010763298-y0LKglvP is distinct from user-selected BrownBot Messaging API2007538833. Do not copy the whole local `.env`.
5. Admin OAuth provider, exact callbacks/TOTP/admin role mapping, imported public signing-key trust/issuer/audience and independent session/scheduler secrets remain to be provisioned/verified. No ordinary-request service-role shortcut.
6. Keep notifications disabled, no production data collection or uploads while approved scanner/retention/legal gates are incomplete. Do not label an HTML shell deploy as critical-flow acceptance.
7. Verify target preflight, immutable source/hosted CI, remote migrations001–006 only under explicit target approval, then deploy and inspect actual build/runtime logs without secret/PII output. Rehearse synthetic critical browser/LIFF/Storage/OAuth/rollback/provider flows before acceptance.

## Upload boundary

`.vercelignore` excludes local env/auth/link files, private-key formats, Git/agent metadata, dependencies/build/cache/log/dump artifacts for source uploads. `.vercel/` is also Git-ignored. This is a preventive filename boundary, not a full secret scanner or proof of what a browser folder picker uploads. Do not upload the unfiltered workspace through a folder picker; do not assume ignore rules revoke an already committed secret. Verify the actual upload/commit manifest before transmission. The [official ignore documentation](https://vercel.com/docs/deployments/vercel-ignore) describes Vercel exclusions.

## Acceptance evidence still missing

Core app deployment identity/build/toolchain and database schema/SQL evidence are recorded. Still missing: configured runtime env preflight, imported JWT/provider trust, admin IdP/MFA and authenticated critical browser/LIFF/Storage flows, approved scanner/retention/legal/notification policies, upstream database transport assurance,007 recovery/alerts and required owners/sign-offs. No completion or production readiness follows from bootstrap success.
