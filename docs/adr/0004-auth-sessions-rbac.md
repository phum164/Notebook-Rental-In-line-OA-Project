# ADR-0004: Separate LINE customer and MFA admin sessions

- Status: Accepted security baseline; identity-provider configuration pending
- Date: 2026-07-13

Customer identity originates from a LINE credential verified server-side for issuer/audience/expiry/nonce and bound to provider subject. The API issues its own opaque HttpOnly session; it never trusts a submitted `line_user_id`. Admin identity uses Supabase Auth (or an A00-approved equivalent), separate cookies and mandatory MFA in staging/production.

Roles are Owner, Operations, Reviewer and Viewer. Server authorization and RLS enforce permission and ownership; client route guards are not security controls. Privileged operations require recent MFA and append-only audit.

## Database principal propagation (CR-A05-01)

Normal customer requests use a server-only, short-lived asymmetric JWT signed by an application key whose public signing key is imported/configured as trusted by Supabase. After validating the opaque application session, the API mints a database token with `kid`, fixed issuer/audience, `role=authenticated`, `sub=<customer UUID>`, `principal_type=customer`, `iat`, `nbf`, `exp` (maximum five minutes) and a request/session correlation identifier. The token is passed to a per-request Supabase client via the supported access-token option with the publishable key and is never returned to the browser, persisted, or logged.

RLS checks issuer/principal type and maps `sub` to the customer row. Admin database access uses the Supabase Auth JWT and requires `aal2` in restrictive policies for privileged data. The secret/service-role key is forbidden for ordinary customer/admin request paths; it is reserved for explicitly documented bootstrap/migration/background operations with narrower database functions where feasible. Signing-key rotation requires overlapping `kid` verification and an A07 runbook.
