# CI/CD design

## Active Wave 1 CI

`.github/workflows/ci.yml` runs on pull requests and pushes to `main` with read-only repository permission. It does not consume repository environment secrets and does not deploy.

Required gates are:

1. Node.js `22.14.0`, pnpm `11.7.0`, and `pnpm install --frozen-lockfile`.
2. `pnpm verify`, covering lint, TypeScript, OpenAPI lint, and unit tests.
3. `pnpm build` to catch production-bundle failures.
4. `pnpm audit --prod --audit-level high` to fail on high/critical production dependency advisories.
5. Gitleaks scanning full available Git history.

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

