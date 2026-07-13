# Deploy, migration, rollback, and forward-fix runbook

Status: scaffold for staging rehearsal. Production execution is prohibited until Wave 5 gates and owner approvals pass.

## Preflight

- Record commit/version, environment, change owner, migration list/checksums, deploy operator, approver, rollback owner, and incident channel.
- Verify the target project ID, database host fingerprint, storage project, domain, and LINE channel against the environment register. Abort on mismatch.
- Confirm CI gates pass on the exact commit and the working tree/artifact is immutable.
- Review A01 compatibility and forward-fix notes. Take or verify the required backup/restore point and quota headroom.
- Confirm A05 security gates and A06 evidence required for the target phase.

## Staging rehearsal

1. Use synthetic staging data and capture baseline health metrics.
2. Apply migrations once using the repository-approved A01 command when supplied. Never invent or edit A01 migrations here.
3. Re-run the migration command to demonstrate idempotent/no-op behavior where the migration tool supports it.
4. Deploy the exact candidate and run `docs/operations/smoke-tests.md`.
5. Exercise the documented rollback or forward-fix path and repeat smoke tests.
6. Restore the staging rehearsal dataset when the scenario requires it; capture durations and evidence without data/secret contents.

## Production sequence (Wave 5 only)

1. Obtain protected-environment approvals and announce the bounded change window.
2. Re-run environment identity and backup preflight; pause risky writes if the approved plan requires it.
3. Apply only rehearsed backward-compatible migrations, then deploy the exact staging-tested candidate.
4. Run read-only and synthetic smoke tests. Closely watch auth, booking conflicts, payment/upload, webhooks, error rate, latency, database/storage quota, and outbox backlog.
5. Declare success only after the observation window and record all evidence.

## Failure decision

- App-only regression with backward-compatible schema: roll the application back to the last known-good version.
- Additive migration defect with safe correction: keep the compatible app and apply the rehearsed forward-fix.
- Data corruption, destructive migration, privacy breach, auth bypass, or unclear blast radius: stop writes, open an incident, preserve evidence, and follow backup/restore procedure. Do not improvise a down migration.
- LINE or optional integration outage: disable the affected worker/integration if designed to do so, preserve outbox events, and continue only within the approved degradation policy.

## Evidence template

Record version, target identifiers (non-secret), migration IDs/checksums, start/end UTC timestamps, Bangkok display time, operators/approvers, backup reference, smoke results, dashboards/alerts checked, rollback decision/owner, and known risks. Never attach tokens, PII, signed URLs, raw KYC/slip/condition data, or secret-bearing logs.

