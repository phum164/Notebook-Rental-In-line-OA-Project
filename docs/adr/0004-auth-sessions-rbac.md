# ADR-0004: Separate LINE customer and MFA admin sessions

- Status: Accepted security baseline; identity-provider configuration pending
- Date: 2026-07-13

Customer identity originates from a LINE credential verified server-side for issuer/audience/expiry/nonce and bound to provider subject. The API issues its own opaque HttpOnly session; it never trusts a submitted `line_user_id`. Admin identity uses Supabase Auth (or an A00-approved equivalent), separate cookies and mandatory MFA in staging/production.

Roles are Owner, Operations, Reviewer and Viewer. Server authorization and RLS enforce permission and ownership; client route guards are not security controls. Privileged operations require recent MFA and append-only audit.

## Admin login completion (CR-A04-01)

Admin login uses a server-started Supabase Auth authorization-code flow with PKCE. `GET /api/v1/admin/auth/login` creates random state/verifier values, stores them only in a five-minute HttpOnly, Secure, SameSite=Lax callback cookie, and redirects to the configured provider. `GET /api/v1/admin/auth/callback` validates state in constant time, consumes the cookie once, exchanges the code server-side, validates issuer/audience/expiry and `aal2`, and calls the existing `get_admin_session` projection to require an enabled mapped admin and known role before setting `nr_admin_session`.

The callback stores only the bounded provider access token in the HttpOnly admin cookie and redirects to `/admin`. It never implements password authentication, accepts a client-supplied role, stores a refresh token in browser storage, or reflects provider errors/tokens into the URL or logs. Expiry requires a new login; sensitive mutations continue to require recent MFA, CSRF and server authorization.

An ordinary OAuth callback may be `aal1`. It then creates only a five-minute encrypted HttpOnly pending-login cookie and redirects to the admin TOTP screen. Same-origin, CSRF-bound challenge/verify operations use an already enrolled Supabase TOTP factor; only the verified `aal2` token and enabled admin mapping establish the admin session. Recent MFA uses a signed `amr` TOTP timestamp (or the existing signed `mfa_verified_at` compatibility claim), never an OAuth/password/refresh timestamp. This follows [Supabase JWT fields](https://supabase.com/docs/guides/auth/jwt-fields) and [MFA](https://supabase.com/docs/guides/auth/auth-mfa).

## Database principal propagation (CR-A05-01 / CR-A02-01)

Normal customer requests use a server-only, short-lived asymmetric JWT signed by an application key whose public signing key is imported/configured as trusted by Supabase. After validating the opaque application session, the API mints a database token with `kid`, fixed issuer/audience, `role=authenticated`, `sub=<customer UUID>`, `principal_type=customer`, `iat`, `nbf`, `exp` (maximum five minutes) and a request/session correlation identifier. The token is passed to a per-request Supabase client via the supported access-token option with the publishable key and is never returned to the browser, persisted, or logged.

RLS checks issuer/principal type and maps `sub` to the customer row. Admin database access uses the Supabase Auth JWT and requires `aal2` in restrictive policies for privileged data. Signing-key rotation requires overlapping `kid` verification and an A07 runbook.

Session bootstrap, lookup and revocation happen before a customer database identity is available. For only those calls, the server mints an asymmetric JWT lasting at most 60 seconds with the same fixed issuer/audience and signing-key rotation rules, `role=app_session_service`, `principal_type=session_service`, one exact `scope` from `session:bootstrap`, `session:resolve`, or `session:revoke`, random UUID `sub` and `jti`, and bounded `iat`/`nbf`/`exp`. The token is never returned, persisted, cached, or logged.

`app_session_service` is a dedicated `NOLOGIN` database role. It receives no table, view, sequence, storage, RLS-bypass, or service-role privileges and may execute only `app_issue_line_bootstrap_nonce`, `app_create_line_session`, `app_resolve_session`, and `app_revoke_session`. The two bootstrap functions share only `scope=session:bootstrap`; issue stores nonce/binding hashes and create atomically consumes them. Each `SECURITY DEFINER` function must pin `search_path`, revoke `PUBLIC`, validate issuer/audience/role/principal type/exact scope/time claims internally, expose a minimum projection, and fail closed. The publishable key plus this scoped JWT is the only normal HTTP path to those functions; `SUPABASE_SERVICE_ROLE_KEY` is forbidden for session bootstrap/resolve/revoke and all ordinary customer/admin requests.
