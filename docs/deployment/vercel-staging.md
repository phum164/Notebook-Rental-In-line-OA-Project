# NotebookRental — Vercel staging preparation

Status2026-10-30: user selected Vercel, logged in and connected GitHub manually. Created an empty project, then renamed it from `project-to50t` to [notebook-rental-staging](https://vercel.com/phum164s-projects/notebook-rental-staging). Project ID `prj_fatdcLXI2ahGzBCyiIrDy8IYXLy3`, account `phum164s-projects`, Hobby. Git settings confirm the exact NotebookRental repository is connected; branch tracking was saved as `codex/staging`. No app deployment, secret, DB mutation or provider operation has been performed yet. The project has a provisioned `project-to50t.vercel.app` alias; this is not proof of a live application.

## Target and source boundary

- Confirmed project name: `notebook-rental-staging`. Separate staging project only; no business-production promotion or paid-plan selection. Vercel's built-in environment named Production belongs to this isolated staging project; its branch is codex/staging and it must contain staging-only values.
- Source repository already configured locally: `phum164/Notebook-Rental-In-line-OA-Project`.
- Existing local HEAD: `a40c3ff` (`fix: allow required pnpm dependency builds`); current accepted runtime/migrations/UI/security work is dirty/untracked, not contained merely by that commit. Importing the current GitHub snapshot does not prove deploying the reviewed candidate.
- User explicitly authorized scoped commit/push to new `codex/staging` on2026-10-30. Preserve `main`, unrelated changes and ignored agent handoffs; never stage `.env`/credentials. Review exact staged diff and redacted secret-scan results before commit/push. The CI workflow now also triggers on this branch so no PR or main push is needed merely to run hosted checks.
- GitHub app installation/repository access or new credentials require action-time confirmation. Do not grant access to every repository by default or automate authentication dialogs.

## Build settings to verify in the actual project

| Setting | Intended value / gate |
|---|---|
| Framework | Next.js |
| Root directory | repository root |
| Install | pinned `pnpm@11.7.0` through `ENABLE_EXPERIMENTAL_COREPACK=1` (must still be configured/verified), frozen lockfile via vercel.json, retaining `pnpm-workspace.yaml` overrides/allowBuilds |
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
3. Authorize the Supabase target explicitly: visible project `Notebook Rental Project`/`vnsyzmaoqcetrnzulylv` is not yet classified/approved as staging. Never migrate merely because that dashboard is open or labels its branch PRODUCTION.
4. Configure public app/Supabase/LIFF values and server secrets privately in the protected target. LINE Login2010763298/LIFF2010763298-y0LKglvP is distinct from user-selected BrownBot Messaging API2007538833. Do not copy the whole local `.env`.
5. Admin OAuth provider, exact callbacks/TOTP/admin role mapping, imported public signing-key trust/issuer/audience and independent session/scheduler secrets remain to be provisioned/verified. No ordinary-request service-role shortcut.
6. Keep notifications disabled, no production data collection or uploads while approved scanner/retention/legal gates are incomplete. Do not label an HTML shell deploy as critical-flow acceptance.
7. Verify target preflight, immutable source/hosted CI, remote migrations001–006 only under explicit target approval, then deploy and inspect actual build/runtime logs without secret/PII output. Rehearse synthetic critical browser/LIFF/Storage/OAuth/rollback/provider flows before acceptance.

## Upload boundary

`.vercelignore` excludes local env/auth/link files, private-key formats, Git/agent metadata, dependencies/build/cache/log/dump artifacts for source uploads. `.vercel/` is also Git-ignored. This is a preventive filename boundary, not a full secret scanner or proof of what a browser folder picker uploads. Do not upload the unfiltered workspace through a folder picker; do not assume ignore rules revoke an already committed secret. Verify the actual upload/commit manifest before transmission. The [official ignore documentation](https://vercel.com/docs/deployments/vercel-ignore) describes Vercel exclusions.

## Acceptance evidence still missing

Project ID/name/account, exact deployed source commit/manifest, branch/environment, generated HTTPS origin, actual Node/pnpm versions, env preflight, hosted CI/build/log/HTTP/browser results, provider/DB/Storage/scanner trust, rollback/recovery and required owners/sign-offs. No completion or production readiness follows from this preparation note.
