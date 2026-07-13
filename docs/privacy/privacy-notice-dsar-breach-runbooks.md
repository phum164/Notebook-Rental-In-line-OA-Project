# Privacy Notice Evidence, DSAR, and Breach Engineering Runbooks

Owners: Privacy/Legal owns legal interpretation and notices; Owner approves business purpose; A05 owns technical safeguards/runbooks; A01 owns deletion/anonymization schema/jobs; A02 owns authenticated commands; A07 owns incident operations/backups; A06 verifies evidence.

## Privacy notice and lawful-basis gate

Before production PII collection, Legal/Owner must approve a versioned notice that describes controller/contact, purposes and approved lawful basis per category, required/optional fields and consequences, recipients/processors/cross-border handling where relevant, retention, rights/request channel, complaint/escalation channel, and version/effective time.

Engineering stores immutable notice version/hash and presentation/acknowledgment evidence. Acknowledgment is not automatically consent. If Legal selects consent for a purpose, store a separate granular, freely given, revocable consent record and withdrawal event; do not bundle optional marketing with rental/KYC processing. Withdrawal must stop only the processing tied to that basis while preserving records required under another approved basis/legal hold.

## Data-subject request (DSAR) runbook

Supported request types: access/copy, correction, deletion/erasure, restriction/objection, consent withdrawal where applicable, and portability where legally applicable. Legal confirms applicability and deadline.

1. **Receive and ticket:** use an approved private channel; create opaque request ID, type, received UTC, scope, due date, and owner. Never ask for KYC images over chat/email merely to open a ticket.
2. **Verify identity proportionately:** authenticate existing LINE/application account and use step-up/case review proportional to request risk. A request to change the LINE binding, address, or receive KYC copies requires stronger manual verification. Record method/result, not excess proof.
3. **Discover:** query by internal customer ID across profile, rentals, delivery, payments/refunds, evidence metadata/objects, condition logs, contract acceptance, notifications, audit references, legal holds, and processor exports. Never search by raw PII in logs.
4. **Assess:** Legal/Privacy decides exemptions, third-party redaction, retention/legal holds, and whether deletion is erase, anonymize, restrict, or reject with reason. Operations pauses automatic purge only through an explicit hold.
5. **Execute:** create a manifest; run idempotent scoped export/correction/purge; revoke signed-read/session access where needed; notify processors using approved procedure. Four-eyes approval is required for bulk/high-risk exports or irreversible deletion.
6. **Review and deliver:** verify export contains only the subject's data and no secrets/object keys/signed URLs/internal security notes/third-party data. Encrypt/package through an approved short-lived channel; communicate separately from any passphrase if used.
7. **Close:** record categories/actions, approver, UTC time, processor confirmation, exceptions/reason, and completion result. Do not retain a duplicate of the exported PII in the ticket.

Negative tests: cross-account request, lost-account/manual verification, customer with multiple rentals, third-party contact in delivery data, legal hold, partial storage failure, restored backup tombstone, expired export link, repeated request, and admin attempting an unauthorized export.

## Personal-data breach runbook

Trigger examples: public/signed sensitive URL exposure, cross-user/role access, stolen session/token/signing/service/LINE key, leaked logs/backups, malware upload, unauthorized admin export, or processor incident.

1. **Detect and preserve:** page Security Incident Owner; create incident ID/severity/time/source. Preserve redacted audit, access, deployment, key-version, and object metadata under controlled hold. Do not copy raw images into chat/tickets.
2. **Contain:** disable affected route/policy/bucket access; revoke signed URLs where possible; rotate/revoke credentials and DB JWT key by `kid`; revoke sessions; isolate compromised environment/account; stop worker/export. Do not delete evidence needed for investigation.
3. **Scope:** identify affected categories, data subjects, objects/rows, principals, access window, environments/processors, confidentiality/integrity/availability impact, and whether data was exfiltrated versus merely exposed. Use opaque IDs in the working log.
4. **Assess and notify:** Privacy/Legal determines regulatory and data-subject notification obligations/timing/content. A05 supplies technical facts; engineering does not decide legal reportability. Owner approves customer/partner communications.
5. **Eradicate/recover:** patch policy/code/config, invalidate keys/sessions, reprocess quarantine, restore from known-good backup if required, replay retention tombstones, and run negative security tests before reopening.
6. **Post-incident:** root-cause/control-gap review, owner/date for actions, processor follow-up, risk register/test updates, and evidence-retention end date.

Minimum incident log: incident ID, UTC timeline, reporter/commander, systems/environments, category/count estimate, key/policy versions, containment actions, decision owners, notification decision reference, recovery verification, and follow-ups. Exclude credentials, signed URLs, raw webhook bodies, full object keys, ID numbers, and images.

## Operational metrics without PII

- DSAR open/overdue count, time-to-verify/discover/close, processor confirmation age, export/deletion failures.
- Retention eligible/purged/failed/hold counts and oldest backlog by category.
- Sensitive signed-read issuance/deny counts by role/purpose, never URL/object/customer.
- Incident detect/contain/recover duration, affected category/count band, credential rotation completion.

Alerts route only to authorized staff; dashboards use environment-separated, aggregated data.

## Release gates

- Legal/Owner-approved notice/lawful basis/consent model and retention values exist for every production PII category.
- DSAR identity verification, discovery manifest, export redaction, delete/anonymize, legal hold, processor action, and backup tombstone flows are tested with synthetic data.
- Breach contacts/escalation, key/session rotation, sensitive-route shutdown, audit discovery, and recovery verification are rehearsed.
- No production PII is copied into dev/staging/test, screenshots, logs, fixtures, or support tickets.

