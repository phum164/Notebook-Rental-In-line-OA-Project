# Backup and restore runbook

Status: design scaffold. Actual RTO/RPO and provider capabilities are release gates under D-15.

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

