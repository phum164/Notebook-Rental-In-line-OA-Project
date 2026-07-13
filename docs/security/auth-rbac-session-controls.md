# Authentication, RBAC, Session, and HTTP Control Design

## Customer LINE bootstrap

1. The client sends a LINE credential and one-time bootstrap nonce only over TLS. It never sends `line_user_id` as authority.
2. The server validates the credential using the expected LINE Login channel/configuration, including validity/expiry, expected channel/audience, issuer where applicable, nonce, and non-empty subject. Any profile fields are advisory and minimized.
3. Nonce/state is single-use, short-lived, and bound to the initiating browser. Credential or provider error details are not reflected to the client.
4. The immutable LINE subject maps to one customer record; account-link conflicts fail closed and create a redacted security event.
5. Issue a random opaque application session. Store only a hash/server-side record containing session kind, customer ID, issued/last-used/absolute expiry, rotation generation, and revocation state.
6. Rotate after bootstrap and material security change; revoke all affected sessions on customer disable or identity rebind. Never return provider access/ID/refresh tokens in application responses.

Reject forged, expired, wrong-channel/audience, wrong issuer where applicable, missing-subject, reused-nonce, and provider-unavailable credentials. Do not fall back to decoded-but-unverified token claims.

### Customer database principal

For each database access, the server validates the opaque session then mints an asymmetric JWT with the current `kid`, allowlisted algorithm, fixed expected `iss`/`aud`, `role=authenticated`, `sub=<customer UUID>`, `principal_type=customer`, `iat`, `nbf`, `exp` at most five minutes later, and request/session correlation. Supply it only to a fresh server-side Supabase client using the publishable key. Never send it to the browser, persist/cache it, or place it in logs/traces/errors.

RLS must distinguish customer tokens from Supabase Auth admin tokens; sharing `role=authenticated` is not authorization. Key rotation imports the new public key first, switches minting by `kid`, retains the old public key only for token lifetime plus allowed clock skew, and then removes it. Reject unknown/retired/missing `kid`, disallowed/none algorithm, wrong issuer/audience/principal type, malformed subject, future/not-yet-valid, expired, or overlong tokens.

## Admin authentication and authorization

- Admin uses a distinct Supabase Auth session/cookie namespace. Accept a verified server-side session only; role membership comes from active database records linked to `auth.uid()`, not editable JWT user metadata or the browser.
- Staging/production require MFA `aal2` for every admin role. Refund initiation/settlement, role changes, contract publishing, and sensitive settings/secret changes additionally require authentication within 15 minutes.
- Roles are `OWNER`, `OPERATIONS`, `REVIEWER`, and `VIEWER` exactly as frozen by A00. Permissions are additive only through Owner-controlled audited membership changes; a user cannot modify its own membership.
- Disable/role change increments authorization version or revokes active sessions so cached permissions cannot survive. Authorization is recalculated for every mutation and sensitive read.

| Capability | Viewer | Reviewer | Operations | Owner | Additional gate |
|---|---:|---:|---:|---:|---|
| Operational redacted reads | Yes | Yes | Yes | Yes | Active admin + `aal2` |
| KYC/slip signed read and verify/reject | No | Case-scoped | No unless explicitly required by workflow | Yes | Sensitive-read audit |
| Inventory mutation | No | No | Yes | Yes | Named command + audit |
| Condition inspection/handover/return | No | No | Case-scoped | Yes | State guard |
| Fees/refund command | No | No | Yes | Yes | Recent MFA + idempotency |
| Settings/contracts/roles | No | No | No | Yes | Recent MFA + immutable audit |

## Session controls

| Property | Customer | Admin |
|---|---|---|
| Cookie | `nr_customer_session` | `nr_admin_session` |
| Idle / absolute expiry | 30 minutes / 12 hours | 15 minutes / 8 hours |
| Attributes | HttpOnly; Secure except local dev; SameSite=Lax; Path=/ | HttpOnly; Secure except local dev; SameSite=Lax; admin/API path scoped where feasible |
| Rotation | Login, privilege/identity change, periodic risk-based | Login, MFA elevation, role change, periodic risk-based |
| Logout/revocation | Delete cookie + revoke server record | Supabase sign-out/revoke + delete cookie |

Never place session/token values in URL, localStorage, application logs, analytics, or error reports. Cookie responses use `Cache-Control: no-store`. Customer and admin sessions are non-interchangeable even if both cookies are present; route family determines required principal and ambiguous state fails closed.

## CSRF, CORS, headers, and caching

- Every cookie-authenticated mutation checks exact trusted `Origin`/`Host`, uses a server-issued CSRF token bound to the session (or an equally strong A00-approved framework control), and accepts only expected content types. SameSite is defense-in-depth, not the only control.
- Default CORS denies cross-origin credentialed requests. Allow only explicit first-party LIFF/admin origins per environment; never use wildcard with credentials.
- Baseline headers: strict CSP with nonces/hashes and explicit LINE/Supabase endpoints, `frame-ancestors` matching the required LIFF embedding behavior, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, narrow `Permissions-Policy`, and HSTS in production after domain readiness.
- Sensitive/API/admin responses are `private, no-store`; public product assets may be cacheable only after sanitization and must not share a bucket/path with private originals.

## Rate limits and abuse controls

Rate-limit by route risk using both verified principal and privacy-preserving IP/network signal. Apply tighter limits to auth bootstrap, signed reads, upload intents/finalize, payment/refund, role changes, and webhook invalid signatures. Limits must not disclose whether a customer/admin/object exists. Use bounded request bodies before JSON parsing and return standard errors with a request ID.

Suggested initial values are operational configuration, not a frozen API contract: auth bootstrap 10 attempts/10 minutes per browser+IP; signed reads 30/minute/admin; upload intents 10/minute/customer plus purpose count limits; privileged commands 10/minute/admin; invalid webhook signatures 60/minute/IP before temporary throttling. A07 must monitor false positives and A00/Product approve material UX changes.

## Logging and audit allowlist

Allowed: request ID, route template, method, response status, duration bucket, principal type, opaque internal actor ID where justified, action/target type, result, idempotency correlation, provider status class, retry count.

Forbidden: cookies, authorization headers, LINE/provider tokens or subject IDs, channel secret/access token, passwords/MFA secrets/codes, raw request bodies, ID-card/profile/contact data, object keys, filenames, signed URLs, raw webhook payloads, QR/payment details, or image metadata. Hashing a low-entropy identifier is not sufficient anonymization.
