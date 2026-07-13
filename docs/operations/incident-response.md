# Incident and breach response

## Severity

- SEV-1: confirmed/suspected PII or secret exposure, auth bypass, incorrect financial settlement, destructive data loss, or widespread outage.
- SEV-2: degraded critical workflow, growing outbox/booking backlog, storage/database capacity risk, or contained security event.
- SEV-3: limited noncritical defect with a workaround and no sensitive-data impact.

## Response flow

1. Detect and open a restricted incident record with UTC time, reporter, environment, release, symptoms, and correlation references.
2. Assign incident commander, operations lead, security/privacy lead, communications lead, and scribe. Do not paste secrets or PII into the channel.
3. Contain: pause deploys, revoke/rotate affected credentials, disable compromised integration, stop risky writes, or isolate access as appropriate. Preserve audit and provider evidence.
4. Assess scope: affected actors/data/time range, authorization path, releases/migrations, financial/booking invariants, storage access, and notification obligations.
5. Recover via known-good deploy, forward-fix, or approved restore. Validate with smoke tests and heightened monitoring.
6. Communicate only through Owner-approved channels. Legal/Owner decides PDPA notification and customer/regulator communication; engineers do not make that determination alone.
7. Close after monitoring, then produce a blameless review with root cause, timeline, controls, owners, due dates, and recurrence tests.

## Special playbooks

- Secret leak: revoke first, rotate dependents, invalidate sessions/tokens where applicable, scan history/logs/artifacts, and assess access since issuance.
- Private object/signed URL exposure: revoke access path, expire links/credentials, inspect access logs, identify object classes and data subjects without copying content.
- Duplicate payment/refund: halt settlement action, preserve idempotency/audit evidence, reconcile with Finance, and use compensating records—never overwrite history.
- Double booking: disable new booking for affected inventory, preserve transaction evidence, reconcile holds/rentals, and escalate customer communication to Operations.

