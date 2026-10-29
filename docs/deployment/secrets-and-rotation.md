# Secret inventory and rotation design

Values are never stored in source, CI logs, tickets, screenshots, or this inventory. This document records names, boundaries, custodians, and procedures only.

| Variable | Classification | Allowed environment | Consumer | Rotation trigger / minimum cadence |
|---|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | public config | one value per environment | browser/server | domain change |
| `NEXT_PUBLIC_LINE_LIFF_ID` | public identifier | environment-specific | browser | LIFF app replacement |
| `NEXT_PUBLIC_SUPABASE_URL` | public endpoint | environment-specific | browser/server | project replacement |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public scoped key | environment-specific | browser/server with RLS | key replacement or incident |
| `SUPABASE_SERVICE_ROLE_KEY` | critical secret | approved maintenance only; never preview | no ordinary API/session/worker consumer | 90 days or suspected exposure |
| `LINE_CHANNEL_ID` | restricted identifier | server only | LINE Login audience verification; channel containing the LIFF app | login channel replacement |
| `LINE_CHANNEL_SECRET` | critical secret | server only | webhook HMAC; approved OA's Messaging API channel, not LINE Login channel | 90 days or suspected exposure |
| `LINE_CHANNEL_ACCESS_TOKEN` | critical secret | server only | notification worker; same approved Messaging API channel as webhook secret | 90 days or suspected exposure |
| `SESSION_SIGNING_SECRET` | critical secret | server only | session service | 90 days or suspected exposure |
| `UPLOAD_SIGNING_SECRET` | critical secret | server only | upload service | 90 days or suspected exposure |
| `CUSTOMER_DB_JWT_PRIVATE_KEY` | critical asymmetric private key | server only; never Supabase/browser/preview | customer JWT issuer | 90 days or suspected exposure; overlap by `kid` |
| `CUSTOMER_DB_JWT_KEY_ID` | restricted key identifier | environment-specific server config | JWT header/JWKS selection | with each private-key rotation |
| `CUSTOMER_DB_JWT_ISSUER` | restricted issuer identifier | environment-specific server/Supabase config | JWT issuer/validator | issuer or environment change |
| `CUSTOMER_DB_JWT_AUDIENCE` | restricted audience | environment-specific server/Supabase config | JWT issuer/validator | audience or environment change |
| `SUPABASE_AUTH_PROVIDER` | server configuration | environment-specific | admin OAuth entry | provider/IdP change |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_PUBLISHABLE_KEY` | public scoped key aliases | environment-specific | ordinary runtime with scoped JWT/RLS | provider key replacement |
| `CRON_SECRET` | critical bearer secret, minimum 32 characters | server scheduler only | `/api/internal/line` | rotation or incident |
| `LINE_NOTIFICATION_POLICY_JSON` | restricted approved templates/recipient configuration | server worker only | LINE outbox renderer | approved policy change; drain/review backlog first |
| `LINE_NOTIFICATIONS_ENABLED` | server feature gate | false until D-13 accepted | LINE worker | explicit release change |

The 90-day cadence is an engineering baseline pending Owner/Security approval. Each environment has independent values. Developers do not receive production values. CI quality jobs receive no application secret.

The runtime deliberately uses two LINE channel types: `LINE_CHANNEL_ID` belongs to customer LINE Login/LIFF, while webhook secret and push access token belong to the approved OA's Messaging API channel. A channel appearing under the same provider is not proof it is the intended rental OA. Record/approve that association before provisioning values; never paste a Login-channel secret into the webhook setting merely because the environment variable is named generically. Current consumers are `supabase-api-operations.ts`, `api/webhooks/line/route.ts` and `api/internal/line/route.ts` respectively.

## Rotation procedure

1. Open a restricted change record with secret name, environment, reason, owner, verifier, start time, and affected services—never the value.
2. Confirm provider recovery access, current health, and rollback/overlap capability.
3. Create a new value in the provider secret store. Where dual-key verification is supported, deploy acceptance of old and new values first.
4. Update only the target environment, redeploy the exact approved commit, and run safe auth/webhook/upload smoke tests.
5. Revoke the old value after the overlap window; for signing secrets, expire or invalidate sessions/tokens according to the incident risk.
6. Verify logs contain neither old nor new values, close the record with timestamps/evidence, and update the next rotation date.

If a provider cannot overlap keys, schedule a maintenance window and prepare the rollback owner. Suspected exposure triggers immediate incident response, revocation, impact analysis, log review, session invalidation as applicable, and notification assessment.

### Customer database JWT key rotation

1. Generate the asymmetric key in an approved secret manager/HSM path; the private key is export-restricted where supported and never entered in Supabase, source, local shared files, or browser configuration.
2. Assign a new unique environment-scoped `kid`. Import/configure only its public verification key in the matching Supabase project and bind the expected issuer/audience/claims according to the A05 policy.
3. Verify Supabase accepts a short-lived synthetic token signed by the new key while still accepting unexpired tokens signed by the old `kid`.
4. Change the issuer to sign new tokens with the new private key/`kid`, observe auth/RLS failures, then wait at least the maximum token lifetime plus clock-skew allowance.
5. Remove the old public key from Supabase and revoke/destroy the old private key. Record both `kid` values, timestamps, actor, verifier, and test results without recording either key.

Normal customer requests use the scoped short-lived JWT and RLS claims. `SUPABASE_SERVICE_ROLE_KEY` is prohibited for normal customer/admin request handling, authorization fallback, or bypassing a failed RLS policy; it is reserved for explicitly approved server maintenance/bootstrap/migration operations with separate audit and least exposure.

## Guardrails

- Only `NEXT_PUBLIC_*` values may enter browser bundles, and their values must still be environment-specific.
- Public JWT verification keys may be configured in the matching Supabase project; asymmetric private signing keys never leave the server-side secret boundary.
- Log variable names and provider request IDs only; never log headers, cookies, tokens, signed URLs, raw webhook bodies, or secret-store output.
- Production secret reads and edits require MFA, named access, and audit evidence.
- Secret scanners are a prevention/detection layer, not permission to commit placeholders that resemble live credentials.
