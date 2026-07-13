# Observability, alerting, and quota baseline

## Telemetry contract

Every inbound request and asynchronous job should carry a generated correlation ID; provider request IDs and idempotency keys are hashed or represented by non-secret internal IDs. Structured events use UTC timestamps and include environment, release version, route/job name, outcome, duration, error code, actor type, and target type. Actor/target database IDs should be tokenized or omitted unless operationally necessary.

Never record tokens, authorization/cookie headers, LINE profile contents, phone/address, ID-card data/images, slip/condition images, storage object paths, signed URLs, secret values, raw webhook bodies, or request/response bodies containing PII.

JWT/auth telemetry may record environment, issuer category, non-sensitive `kid`, validation outcome, and error code, but never the JWT or claims containing identity. Alert on unexpected issuer/`kid`, retired-key use, or any detected service-role use on a normal request path.

## Minimum signals and alerts

| Area | Signals | Initial alert condition |
|---|---|---|
| Availability | request count, 5xx rate, latency | 5xx > 5% for 5 min or health check fails 3 times |
| Auth/RBAC | verification failures, forbidden mutations, MFA failures | sudden 3x baseline or repeated privileged denial for one actor/IP |
| Booking | conflict rate, transaction retries, hold-expiry backlog | unexpected conflict spike or expiry backlog > 10 min |
| Payment/refund | verification failures, duplicate/idempotency conflicts | any duplicate settlement invariant violation |
| Upload/storage | validation rejects, signing failures, quarantine backlog | signing failures > 5 in 5 min or quarantine backlog > 15 min |
| LINE/webhook | invalid signatures, replay rejects, outbox age/retries/dead letters | any signature spike; oldest outbox event > 10 min |
| Database/platform | connections, CPU, storage, egress, function duration | 70% warning, 85% urgent for quota/capacity |
| Security/privacy | secret-scan failure, admin/secret changes, audit write failure | immediate page for secret/audit/auth bypass signal |

Thresholds are conservative Wave 1 baselines and must be tuned in staging. Alerts route to the named on-call/release operator with severity, environment, release, correlation reference, and runbook link—but no sensitive payload.

## SLO and quota gates

D-15 remains unapproved. Before production, Owner and DevOps must approve measurable availability/latency SLOs, an error budget, RTO/RPO, support hours, and escalation contacts. No document should imply a provider free tier supplies an unverified SLA, PITR, or backup guarantee.

Quota owners review Vercel, Supabase, storage, database, LINE messaging, build minutes, bandwidth/egress, and log retention weekly in staging and daily during production launch. At 70%, reduce nonessential polling/log volume and investigate growth; at 85%, freeze load-increasing releases and approve an upgrade or degradation plan; at 95%, page the owner and activate the approved degradation mode. Upload limits, rate limits, retention, pagination, and outbox backpressure remain mandatory controls.
