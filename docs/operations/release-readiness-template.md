# Release readiness report template

Wave 1 provides this template only. Completion belongs to A07 Wave 5 after A06 evidence.

## Candidate

- Version/commit/artifact:
- Change owner / release operator / approvers:
- Staging and production project/domain identifiers (non-secret):
- Change window and Bangkok/UTC timestamps:

## Evidence

| Gate | Evidence reference | Result / owner |
|---|---|---|
| CI exact commit: verify/build/audit/secret scan | | |
| A01 migrations/checksums/compatibility | | |
| A05 auth/storage/privacy/secret review | | |
| A06 critical QA and defect closure | | |
| Staging deploy/migration/smoke | | |
| Rollback or forward-fix rehearsal | | |
| Backup/restore drill vs approved RTO/RPO | | |
| Alerts/log redaction/quota headroom | | |
| Vercel/Supabase/LINE env, domain, callbacks | | |
| Product/Legal/Finance/Ops decisions and sign-offs | | |

## Migration and rollback

- Migration IDs/checksums and order:
- Backup reference and restore evidence:
- Rollback/forward-fix decision tree:
- Named rollback owner and stop conditions:

## Known risks and decision

- Open risks, severity, mitigation, owner, expiry:
- Go/no-go decision, approvers, and UTC timestamp:
- Post-deploy observation window and success criteria:

