# Roles, Permissions and Session Boundaries

This Wave 0 baseline is least-privilege. Owner approval and production identity-provider configuration remain release gates.

## Principals

| Principal | Authentication | Scope |
|---|---|---|
| Anonymous | none | Public, non-sensitive active laptop catalog only |
| Customer | server-verified LINE identity → application session | Own profile, quotes, rentals and scoped upload intents |
| Viewer | Admin Auth + MFA | Read operational records; sensitive media denied |
| Reviewer | Admin Auth + MFA | Viewer + review KYC/payment and approve/reject within state guards |
| Operations | Admin Auth + MFA | Inventory, handover/return inspection, fee/refund commands |
| Owner | Admin Auth + MFA | All admin permissions, roles/settings/contracts; no bypass of state/audit/idempotency |
| Service worker | server credential + narrow internal policy | Outbox delivery/retention jobs only |

## Permission matrix

| Capability | Customer | Viewer | Reviewer | Operations | Owner |
|---|---:|---:|---:|---:|---:|
| Read public catalog | own session/public | yes | yes | yes | yes |
| Read rental | own only | yes | yes | yes | yes |
| Create booking/upload own evidence | own only | no | no | no | no |
| View KYC/slip signed media | no after submit | no | yes | case-limited | yes |
| Verify/reject KYC/payment | no | no | yes | no | yes |
| Inventory mutation | no | no | no | yes | yes |
| Before/after inspection | no | no | no | yes | yes |
| Assess fees/initiate refund | no | no | no | yes | yes |
| Change settings/contracts/roles | no | no | no | no | yes |
| Read audit | own public timeline only | yes (redacted) | yes | yes | yes |

All authorization is repeated server-side. UI visibility is usability only. Sensitive read URLs expire within 60 seconds by baseline and are scoped to one object and one authorized request.

## Sessions

- Customer bootstrap accepts a LINE credential once, verifies it server-side, and issues a rotating opaque session cookie. Baseline idle/absolute expiry: 30 minutes/12 hours.
- For each database access, the server maps that verified customer session to a short-lived asymmetric database JWT (`role=authenticated`, `sub=customer UUID`, `principal_type=customer`) kept server-side and supplied with the Supabase publishable key so RLS remains active.
- Admin uses a separate cookie namespace and route group. Baseline idle/absolute expiry: 15 minutes/8 hours. MFA is mandatory for every admin role in staging/production; recent MFA (≤15 minutes) is required for refund, role and secret/settings changes.
- Sessions are HttpOnly, Secure outside local development, SameSite=Lax, rotated after login/privilege change, and revoked on account disable/role change.
- Customer and admin session types cannot be substituted. API responses do not expose LINE access tokens or provider refresh tokens.
- Imported application JWT signing private keys are server-only and rotated by `kid`; the Supabase secret/service-role key is not used on ordinary request paths.
