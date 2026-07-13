# Environment isolation and access matrix

Status: Wave 1 design baseline. Staging integration and every production action remain blocked by the gates below.

## Isolation rules

| Boundary | Development | Staging | Production |
|---|---|---|---|
| Vercel project | Local or dedicated development project | Dedicated staging project | Dedicated production project |
| Supabase project | Dedicated development DB and buckets | Dedicated staging DB and buckets | Dedicated production DB and buckets |
| LINE | Mock or dedicated development channel | Dedicated test channel and LIFF app | Dedicated production channel and LIFF app |
| Data | Synthetic only | Synthetic only unless Owner and Legal approve otherwise | Real data only after all release/privacy gates |
| Secrets | Developer-scoped local values | Staging-only managed values | Production-only managed values |
| Domain/callbacks | localhost/development allowlist | Staging domain only | Production domain only |
| Operators | Engineers assigned to the task | Release engineer plus approved reviewers | Named Owner and release operators only |

Preview deployments are treated as untrusted development. They must never inherit production or staging database credentials, storage credentials, LINE credentials, callbacks, or domains. Environment identifiers are checked before migrations and smoke tests; copying a production snapshot into a lower environment is prohibited.

Each Supabase environment imports only the public verification keys for its customer JWT issuer. Private signing keys, `kid`, and issuer configuration are independent per environment; overlapping public keys are allowed only during a recorded rotation window. Normal requests must use scoped sessions/JWT plus RLS and must never use the service-role key as an authorization shortcut.

## Access matrix

| Capability | Developer | CI | Staging release operator | Production release operator | Owner/security reviewer |
|---|---:|---:|---:|---:|---:|
| Read synthetic dev data | yes | no | as needed | no | no |
| Change dev configuration | yes | no | yes | no | no |
| Run quality CI | yes | yes, no deploy credentials | yes | yes | read evidence |
| Deploy staging | no by default | future protected job only | yes, after A01/A05 gates | no | approve high-risk change |
| Run staging migrations | no by default | future protected job only | yes, after rehearsal | no | read evidence |
| Read staging sensitive objects | no | no | break-glass only | no | approve/investigate |
| Deploy/migrate production | no | no in Wave 1 | no | two-person approval only | approve |
| Read production PII/private objects | no | no | no | time-bound break-glass | approve and audit |
| Rotate production secrets | no | no | no | two-person operation | approve and verify |
| Configure Supabase JWT public keys | dev only | no | staging only | production, two-person change | approve and verify |

All staging and production admin roles require MFA. Refund, role, secret, and settings operations require recent MFA as defined by ADR-0004. Human access is named, least-privilege, time-bound where possible, and reviewed quarterly and after personnel changes.

## Promotion and release gates

1. CI quality, dependency audit, and secret scan pass on the exact commit.
2. A01 supplies repeatable migration and forward-fix notes; A05 supplies security/storage/auth baseline.
3. Staging variables, domains, LINE callback/webhook, and project identifiers are independently verified.
4. Migration and smoke tests succeed in staging using synthetic data; rollback/forward-fix is rehearsed.
5. A06 critical QA passes with no unresolved high-severity defect.
6. Owner approves D-09/D-10/D-15/D-16 and all applicable product/legal/finance gates.
7. Production deployment uses a protected environment with two-person approval and named rollback owner.

No production deploy is configured in Wave 1.
