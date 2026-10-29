# Backup and restore runbook

Status: local database restore rehearsal evidenced; provider recovery, actual RTO/RPO and provider capabilities remain release gates under D-15.

## Existing local recovery evidence (2026-10-29)

Reuse `docs/agent-plan/handoffs/A01-critical-workflow-completion.md`; do not repeat or promote this to live-provider evidence. A01 ran PostgreSQL17.6 on loopback, created an empty database, applied compatibility bootstrap + migrations001–005 + seed, then executed all eight SQL suites and a real two-connection booking race (one commit, one `23P01` conflict).

`pg_dump -Fc` produced a 378277-byte synthetic-data dump (SHA256 `FDD4552D9ACCE8F876060A3CC64EBA8EC7D61833F961E8B47CF9470CD3E12A3C`); `pg_restore --exit-on-error` into another empty database passed. `tests/database/restore-invariants.sql`, the critical RPC lifecycle, race assertion, RLS, storage intent and durable LINE receipt checks passed on the restored database. Source/restored aggregate row counts matched. The lifecycle suites roll back, so the backup does not claim to contain persistent payment/refund/inspection rows. The temporary cluster was stopped and no matching database/initdb process remained.

This is same-cluster recovery with existing global roles, not an independent Supabase/Storage/Auth/PITR disaster-recovery proof. It does not restore object bytes, imported verification keys or secrets; no production backup was accessed. No measured end-to-end RTO or approved RPO exists. Before release, the named recovery operator must verify the selected provider plan, cross-target role/config recovery, encrypted database and private-object backup scope, actual restore duration/data-loss window, retention/legal holds, and alert routing against approved D-15 targets.

Subsequent A06 review proved a non-UTC timestamptz-default defect and expired-upload capacity exhaustion. A01 forward migration006 fixes both: clean001–006 + seed, eleven SQL suites and restore invariants pass, including UTC/Bangkok/New York and actual zero-offset Bangkok INSERT/UPDATE. See `A01-qa-timezone-fix.md` and the final hash manifest in the release-readiness report. The successful001–005 dump/restore above remains historical snapshot005 evidence; no006 dump/restore or cross-target/private-object recovery drill was executed.

## Scope and invariants

Backup planning covers PostgreSQL data, migration metadata, private storage object inventory/content as legally approved, and required configuration metadata. Provider dashboards or PITR are not assumed available until the selected plan is verified. Secrets are recovered from their secret manager procedure, not copied into application backups.

Backups containing PII remain encrypted, access-controlled, environment-bound, auditable, and subject to the approved retention/deletion policy. Production data is never restored into development or staging.

## Backup evidence

For each backup record environment, provider backup/reference ID, database/storage scope, start/end UTC, encryption/access policy, retention expiry, operator, result, and non-sensitive checksum/manifest reference. Monitor backup age and failed jobs; a backup without a successful restore test is not accepted as recovery evidence.

## Restore drill

1. Obtain approval and select an isolated recovery target of the same classification as the source.
2. Verify target identity, access, capacity, backup integrity, migration compatibility, and legal retention constraints.
3. Restore database and private storage according to provider-approved procedures; do not print rows, object paths, or credentials in logs.
4. Reconcile row/object counts using aggregate non-sensitive checks, migration version, critical constraints, and audit/outbox consistency.
5. Run smoke tests with authorized synthetic probes, measure restore duration and data-loss window, and compare with approved RTO/RPO.
6. Destroy the temporary recovery target according to policy and record evidence, gaps, and remediation owners.

## Production recovery

Declare an incident, stop conflicting writes, establish the recovery point, obtain Owner/Security approval, and name a recovery and verification lead. After restore, rotate credentials if compromise is possible, replay only idempotent/reconciled work, validate financial and booking invariants, monitor closely, and issue required incident/privacy communications.

