# CI/CD design

## Active CI (local preparation, hosted execution pending)

`.github/workflows/ci.yml` runs on pull requests and pushes to `main` or the explicitly authorized `codex/staging` branch with read-only repository permission. It receives no application/deployment secrets and does not deploy. Checkouts do not persist the GitHub token. The secret-scan action receives only the read-only ephemeral `github.token` and, for an organization-owned repository, a scanner license. PR comments and finding artifacts are disabled so the scanner does not publish findings or require write permission.

Required gates are:

1. Node.js `22.14.0`, pnpm `11.7.0`, explicit version/packageManager assertions, and `pnpm install --frozen-lockfile`. `pnpm-workspace.yaml` supplies the reviewed lifecycle-script allowlist and transitive security overrides; it must travel with `package.json` and `pnpm-lock.yaml`.
2. `pnpm verify`, covering lint, TypeScript, OpenAPI lint, and unit tests.
3. `pnpm build` to catch production-bundle failures.
4. `pnpm audit --prod --audit-level high` to fail on high/critical production dependency advisories.
5. Gitleaks scanning the push/PR change range with full Git history available. This is not an assertion that every historical commit is rescanned on every event. A release additionally requires an approved full-history scan and an uncommitted/untracked source scan; never include `.env` content in logs.

The first hosted staging run on28838cc proved that pnpm11 no longer reads legacy `onlyBuiltDependencies`: frozen install failed `ERR_PNPM_IGNORED_BUILDS` for core-js/protobufjs/unrs-resolver despite the old list. Use the `allowBuilds` boolean map for exactly core-js, protobufjs, sharp and unrs-resolver, per the [pnpm11 migration notes](https://pnpm.io/blog/releases/11.0). Do not disable strict build checks or permit every dependency's scripts. A cached local repeat install was not sufficient to expose this clean-runner failure.

Node selection happens before pnpm installation in both Node-consuming jobs. Node24-based `checkout@v6`, `setup-node@v6`, `pnpm/action-setup@v6` and `gitleaks-action@v3` replace the older action runtimes; this action runtime is distinct from the application Node22 runtime. The selected definitions were checked against the [official checkout action](https://github.com/actions/checkout/blob/v6/action.yml), [setup-node action](https://github.com/actions/setup-node/blob/v6/action.yml), [pnpm action](https://github.com/pnpm/action-setup/blob/v6/action.yml), and [Gitleaks action](https://github.com/gitleaks/gitleaks-action/blob/v3/action.yml).

Gitleaks requires a license for organization repositories, not personal ones; the approved owner must provision `GITLEAKS_LICENSE` if applicable. Fork PRs cannot receive this secret: a missing required license is a failing gate, never a reason to use `pull_request_target` or expose secrets to untrusted code. See the [official scanner configuration](https://github.com/gitleaks/gitleaks-action#environment-variables). Do not disable the gate or insert a fake license. Action tags remain mutable; record resolved action SHAs from the hosted run and review/pin them under the repository's change policy before production promotion.

A07's shell reported Node `22.23.4`/pnpm `11.25.0`; A00's final bundled central run used Node `24.22.1`/pnpm `11.25.0` and passed frozen install/verify (200 tests)/production build/audit-high (one moderate advisory remains). Neither run establishes the pinned Ubuntu toolchain result; require actual hosted jobs on the final immutable candidate before release. `pnpm env:check` is a separate protected-environment preflight, not part of credential-free PR CI: it intentionally fails when real environment configuration is unavailable and never validates provider trust or business approvals.

Follow-up2026-10-30: that one-moderate snapshot is historical. A00 patched only the Next baseline-browser-mapping branch through the existing override convention; offline frozen install, actual Next-resolution error/valid-input self-check and a new build passed, and production audit reports zero known advisories in the current registry response. See `docs/agent-plan/handoffs/A00-dependency-audit-2026-10-30.md`; no new200-test or hosted CI run is inferred.

Branch protection should require all three jobs and dismiss stale approvals. Action version upgrades are reviewed changes. A dependency-audit registry outage is not silently ignored: the release operator records the outage, retries, and obtains Security approval for any time-bound exception.

## Future CD (blocked)

CD is intentionally not implemented in Wave 1. After A01 migration and A05 security handoffs are accepted, add a staging-only protected workflow with workload identity or platform-native credentials, exact-commit artifact promotion, environment identity preflight, migration rehearsal, and smoke tests. Production remains blocked until A06 and the Wave 5 checklist pass.

Production CD must:

- promote the exact staging-tested commit/artifact rather than rebuild mutable inputs;
- use a protected `production` environment with two independent approvals;
- serialize deploy and migration operations;
- capture release version, migration IDs, actor, timestamps, smoke results, and rollback owner without secrets or PII;
- stop before destructive or irreversible schema changes and use expand/migrate/contract sequencing;
- never expose server variables to preview builds or `NEXT_PUBLIC_*` names.

## Change control

A failed critical gate blocks promotion. Fixes land through the owning agent and rerun the full gate. Emergency exceptions require Owner and Security approval, a linked incident/change record, explicit expiry, compensating controls, and a post-release remediation owner.

