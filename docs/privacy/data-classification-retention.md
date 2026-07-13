# Privacy Data Inventory, Classification, and Retention Design

This is privacy-by-design engineering input, not legal advice. **Production collection of KYC or other production PII is prohibited until Legal/Owner approve the lawful basis, notice, consent/acknowledgment evidence where applicable, purposes, recipients/processors, data-subject rights process, and category-specific retention.**

## Classification levels

| Level | Meaning | Examples | Minimum controls |
|---|---|---|---|
| Public | Intended for anyone | Sanitized laptop catalog/product images, published contract text/privacy notice | Integrity review; public cache permitted |
| Internal | Non-public but not customer PII | Deployment metadata, redacted operational metrics, template IDs | Authenticated staff; environment separation |
| Confidential | Customer/business data with material harm if disclosed | Name, phone, LINE subject binding, rental timeline, address/contact snapshot, payment/refund metadata, notes | Purpose/role/row scope, encryption in transit/at rest, no public cache, audit mutations |
| Restricted | Identity/payment/evidence/secrets or data enabling account compromise | ID-card/KYC images, slips, condition evidence, signed URLs/object keys, sessions/tokens, channel/service/signing secrets, MFA data | Private/default-deny, short signed access, sensitive-read audit, strict retention/legal hold, redacted logs; secrets never in domain DB |

## Data inventory and purpose map

| Category | Fields/artifacts | Purpose | Source | Access | Sharing/processor | Classification |
|---|---|---|---|---|---|---|
| LINE identity binding | Provider subject, profile fields strictly needed for service | Login/account continuity/contact | LINE/user | Own customer; minimum admin support; auth service | LINE, hosting/database processors | Confidential; token Restricted |
| Customer profile/contact | Name, phone, preferred contact | Rental fulfillment/support | Customer | Own customer; case-scoped operations/owner | Hosting/database, delivery party only if approved | Confidential |
| Delivery snapshot | Recipient/contact/address, tracking references/timestamps | Handover/return fulfillment | Customer/admin | Case-scoped operations/owner | Approved carrier if integration is later added | Confidential |
| KYC | ID-card images and review outcome/reason | Manual identity review for rental risk | Customer/admin reviewer | Reviewer/Owner only; customer no image read after submission | Storage/database; no new KYC provider in MVP | Restricted |
| Payment/refund | Amount/status/reference, QR setting, slip, fee/refund records | Verify payment and settlement | Customer/admin | Own safe status; Reviewer/Operations/Owner by duty | Bank/payment parties outside system as approved | Metadata Confidential; slip Restricted |
| Rental/contract | Dates, laptop, state, immutable contract version/hash/acceptance context | Perform rental and prove agreed version | System/customer/admin | Own customer; role-scoped admin | Hosting/database | Confidential |
| Condition/dispute | Before/after photos, notes, fee linkage, hold status | Handover, return, dispute evidence | Operations/Owner | Operations/Owner only in Wave 1 | Storage/database; legal/insurer only under approved process | Restricted |
| Audit/security | Actor internal ID/type, action/target/result/time/correlation, auth/security events | Accountability, fraud/incident investigation | System | Redacted role-scoped admin/security | Observability processor | Confidential; secrets/PII excluded |
| Notifications/webhooks | Recipient reference, template/event, status/correlation; normalized receipt | Transactional communication/retry | System/LINE | Worker and redacted operations | LINE | Confidential; provider credential Restricted |
| Technical telemetry | Route template, status, latency, retry/quota metrics | Reliability/security monitoring | System | Engineering/operations | Hosting/observability | Internal; must exclude PII |

## Minimization and evidence rules

- Do not store full LINE credentials, refresh tokens, raw webhook bodies, permanent signed URLs, image-derived text/OCR, facial templates, or copies of an ID number unless Legal/Owner separately approve a documented necessity.
- Manual KYC outcome records should keep only decision, reviewer, UTC time, approved reason code/short note, and evidence reference. This MVP does not claim high-assurance identity verification.
- Privacy notice/version acknowledgment and contract acceptance are separate evidence. Do not treat a contract checkbox as blanket consent. For each evidence record store notice/version/hash, purpose/lawful-basis code once legally approved, actor/customer, UTC time, locale, and request correlation; withdrawal applies only where the approved basis/process says it does.
- Free-text notes are high-risk: UI/API must warn against unnecessary ID numbers/medical/financial detail; server limits length; access is case-scoped; exports redact by default.

## Retention schedule framework

Retention starts from a named event, not `created_at` by assumption. Values marked `LEGAL-TBD` are hard production gates, not permission to retain forever.

| Category | Start event | Retention / action | Legal hold | Owner / approver |
|---|---|---|---|---|
| Failed/expired unfinalized uploads | Intent expiry | Purge within 24 hours | No, unless security incident | Security + Operations |
| Quarantine | Quarantine decision | Purge within 7 days after investigation; extend only under incident case | Yes | Security incident owner |
| KYC image/outcome | Rental rejected/cancelled/completed or dispute closed | `LEGAL-TBD`; purge image and minimize/anonymize outcome when period ends | Yes | Legal + Owner + Security |
| Payment slip/records | Settlement and legally relevant accounting event | `LEGAL-TBD`; image may have shorter period than ledger metadata | Yes | Legal + Finance + Owner |
| Condition evidence/notes | Return inspection or dispute closure | `LEGAL-TBD`, tied to dispute/claim limitation need | Yes | Legal + Owner + Operations |
| Delivery/contact snapshot | Fulfillment/return completion | `LEGAL-TBD`; delete/anonymize when no support/legal need | Yes | Legal + Owner + Operations |
| LINE profile/binding | Last activity/account closure | `LEGAL-TBD`; delete optional profile fields earlier; keep only necessary binding if account remains | Yes | Legal + Owner |
| Contract acceptance | Contract completion/termination | `LEGAL-TBD`; immutable while retained | Yes | Legal + Owner |
| Audit/security events | Event time or case closure | `LEGAL-TBD`; use pseudonymous internal actor where possible | Yes | Legal + Security + Owner |
| Notification/webhook normalized records | Delivery/receipt processing | Operational metadata target 30 days, subject to Owner/Ops approval; delete payload variables earlier | Incident hold only | Owner + Ops + Security |
| Backups | Backup creation | A07 schedule must expire copies within approved category maximum or document technical lag | Legal hold/incident restore controlled | Owner + DevOps + Legal |

No production job may interpret `LEGAL-TBD` as unlimited retention. Production readiness must fail until all production PII categories have approved durations and the deletion/anonymization job plus backup-expiry behavior are tested.

## Retention execution design

1. Daily planner selects eligible rows using category policy version, named start event, UTC cutoff, and legal-hold status.
2. Write a purge manifest containing opaque record IDs, category, policy version, cutoff, and correlation—never signed URLs or raw PII.
3. Mark pending purge transactionally so new signed reads/processing stop; delete private object; then delete/anonymize metadata according to referential/audit rules.
4. Failures retry idempotently and alert on age. Partial deletion remains visible without re-exposing data.
5. Append a privacy audit event with counts/result/policy version. Do not include object keys or subject data.
6. Backups are not edited in place. Track their expiry; if restored, rerun tombstones/purge manifests before reopening service.

Quarterly, the Privacy Owner reviews policy versions, legal holds, purge backlog, processor list, access logs, and categories without an approved schedule.

