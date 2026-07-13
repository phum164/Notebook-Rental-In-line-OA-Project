# RLS and Storage Policy Proposal — Wave 1

Status: **design proposal for A01 implementation**. A01 owns schema, helper functions, grants, migrations, and policy SQL. This document does not change the frozen API contract.

## Enforcement model and identity context

1. Enable RLS on every application table exposed through the Supabase Data API. Revoke broad grants first, then grant only the operations listed below. No policy means deny.
2. The Next.js API remains the primary policy-enforcement point. RLS is an independent backstop; a service-role client must not be used for ordinary customer/admin requests because it bypasses RLS.
3. Admin requests use a verified Supabase Auth JWT. Policy helpers must derive `admin_id` from `auth.uid()`, resolve active roles from database-owned membership rows, and require JWT `aal = aal2` in staging/production. Never authorize from client-supplied role metadata.
4. Customer requests use an A00-approved opaque application session. After verifying that session, the server mints a server-only asymmetric database JWT with `role=authenticated`, `sub=<customer UUID>`, `principal_type=customer`, fixed expected `iss`/`aud`, current `kid`, `iat`, `nbf`, and `exp` no more than five minutes later. It is supplied to a per-request Supabase client with the publishable key and is never returned to the browser, persisted, cached, or logged. Direct `anon`/browser access to private rows remains denied.
5. Service workers use a distinct server-only principal limited to outbox delivery and retention jobs. Do not reuse it for interactive APIs. Every worker mutation is target-scoped, audited, and idempotent.
6. Policy helpers and `SECURITY DEFINER` functions must have a fixed safe `search_path`, owner not exposed to application roles, explicit `EXECUTE` grants, and tests proving they cannot be called with a forged principal.

Required logical helpers (A01 may choose names): current customer ID, current admin ID, active admin role check, `aal2` check, service-worker purpose check, rental ownership check, and case-scoped reviewer/operations access. Customer helpers require the expected issuer, audience, `principal_type=customer`, `role=authenticated`, valid UUID subject, and valid temporal claims. Admin helpers reject customer-minted tokens even though both use `authenticated`. Helpers must return false on absent/malformed context.

## Table access matrix

`Own` means a verified customer ID equals the row's customer/parent-rental owner. `Case` means the row is linked to the operational rental being reviewed. All mutations also pass state guards, column allowlists, validation, idempotency, and audit requirements.

| Resource class | Anonymous | Customer | Viewer | Reviewer | Operations | Owner | Service worker |
|---|---|---|---|---|---|---|---|
| Active laptops + sanitized product image metadata | Select public columns only | Select public columns | Select | Select | Select/insert/update/soft-delete | Full except hard-delete history | None |
| Customer/profile and delivery/contact data | Deny | Select/update own minimized fields through server command | Redacted operational select only | Case-limited select required for review | Case-limited select/update delivery workflow fields | Select/update for supported workflow | Retention delete/anonymize only |
| Rentals/holds/quotes | Deny | Select own; insert/commands through server API only | Select redacted | Select + review commands for assigned/eligible case | Select + operational commands | All named commands | Expire holds only |
| Payments/refunds/fee obligations | Deny | Select own safe fields; submit evidence via command | Redacted select | Select + verify/reject payment only | Select + fee/refund commands | All named commands | Settlement/outbox work explicitly leased only |
| Evidence metadata (KYC/slip/condition) | Deny | Create/finalize own allowed purpose; safe status select; no read URL after submission | Deny sensitive metadata/object access | Case KYC/slip select and signed-read authorization | Case condition evidence; slip only if workflow requires | Case/all operational select and signed-read authorization | Quarantine/purge only |
| Condition logs | Deny | Safe timeline only; no evidence object | Redacted select | Redacted select | Case select/insert; correction is append-only | Select/insert | Retention only |
| Contract versions | Published current/versioned content only | Select published; accept via own-rental command | Select published | Select published | Select published | Draft/publish named commands | None |
| Contract acceptances/status history | Deny | Select own safe evidence/timeline | Redacted select | Select case | Select case | Select | Retention/anonymization only if legally approved |
| System settings | Public allowlisted keys only | Public allowlisted keys only | Redacted operational select | Redacted operational select | Redacted operational select | Named updates; secrets never stored in public settings | Read minimum notification template only |
| Admin profiles/role memberships | Deny | Deny | Select self | Select self | Select self | Select/insert/update/revoke roles with recent MFA | Deny |
| Audit events | Deny | Own public timeline projection only | Redacted select | Redacted select | Redacted select | Redacted select | Append only for own job; no update/delete |
| Idempotency records | Deny | No direct access | No direct access | No direct access | No direct access | No direct access | Operation-scoped read/insert/update outcome only |
| Outbox events | Deny | Deny | Redacted status only if required | Redacted status only if required | Redacted status/operational retry request | Select/retry command | Claim/update delivery state only |
| Webhook receipts/replay keys | Deny | Deny | Deny | Deny | Redacted diagnostics | Redacted diagnostics | Insert/deduplicate/process only |

### Column and command constraints

- Policies alone do not prevent mass assignment. Customer/admin writes must use named functions or server commands with explicit column lists; revoke direct `UPDATE` for state, money, ownership, verification, role, audit, and contract-evidence columns.
- Customer responses exclude LINE subject identifiers, private object keys, reviewer notes, internal risk flags, address/contact fields unrelated to the current workflow, and other customers' identifiers.
- `Viewer` never reads KYC, slips, condition images, full ID details, signed URLs, secrets, or raw notification payloads.
- Reviewer access is limited to KYC/payment case work. Operations access is limited to inventory, handover/return, condition, fees, refunds, and required delivery fields. Neither role can grant itself permissions.
- Owner has broad business authority but cannot bypass immutable audit, state-machine, idempotency, or private-object controls.

## Storage classes and object access matrix

Proposed buckets are logical names; A01 may choose physical names while preserving isolation.

| Storage class | Public bucket | Read | Insert/upload | Update/upsert | Delete | Object path invariant |
|---|---:|---|---|---|---|---|
| Product images | Yes, sanitized derivatives only | Anonymous | Operations/Owner through managed pipeline | Deny overwrite; create new immutable key | Operations/Owner soft-reference removal; lifecycle job physical purge | `laptops/{laptopId}/{randomId}.{ext}` |
| KYC evidence | No | Reviewer/Owner, case-scoped, via 60s single-object signed URL; customer denied after finalize | Customer via one-use upload intent for own rental | Deny | Retention worker only after legal hold check | `kyc/{rentalId}/{uploadId}/{randomId}` |
| Payment slips | No | Reviewer/Owner; Operations only when explicitly needed for case | Customer via one-use upload intent for own rental/payment attempt | Deny | Retention worker only | `slips/{rentalId}/{uploadId}/{randomId}` |
| Condition evidence | No | Operations/Owner only in Wave 1 | Operations/Owner via intent for eligible inspection stage | Deny | Retention worker only after dispute/legal hold | `conditions/{rentalId}/{stage}/{uploadId}/{randomId}` |
| Quarantine | No | Automated scanner/authorized security incident responder only | Finalize pipeline moves/copies suspicious objects | Deny | Quarantine lifecycle worker | `quarantine/{sourceClass}/{uploadId}/{randomId}` |

Storage policy requirements:

- Sensitive buckets are private/default-deny. Never create a public KYC, slip, condition, quarantine, or original-upload bucket.
- Do not permit bucket listing, prefix enumeration, client-chosen object keys, broad signed tokens, overwrite/upsert, move, copy, or client delete.
- An upload intent binds one random server-generated key to actor, purpose, target resource, declared size/MIME, expiry, and one-time status. Storage `INSERT` must match every binding; finalization consumes it atomically.
- Signed reads are created server-side only after fresh authorization, scoped to one object, expire in at most 60 seconds, use `Cache-Control: private, no-store`, and are never persisted or logged.
- `storage.objects.owner_id` is not sufficient ownership evidence when server/service credentials upload objects. The application evidence row plus verified intent is authoritative.
- Database evidence metadata records bucket/key, purpose, target, uploader, detected MIME/size/hash, scan/quarantine state, created/finalized timestamps, and retention/legal-hold status; never a permanent signed URL.

## Required A01 policy tests

1. Anonymous and cross-customer reads/writes of every private table return no row/deny.
2. Forged customer context, client role, missing context, disabled admin, `aal1`, and stale role membership deny.
3. Each admin role has positive tests only for its matrix cells and negative tests for adjacent higher privileges.
4. Sensitive buckets reject anonymous read/list, public URL, wrong prefix, wrong target, expired/consumed intent, overwrite, delete, and cross-case access.
5. Service worker cannot read customer media or mutate domain rows outside the leased outbox/retention operation.
6. Owner cannot update/delete append-only audit, status history, contract acceptance, or finalized evidence.

## Resolved architecture decision — CR-A05-01

A00 selected a server-only, short-lived asymmetric database JWT. A01 may store the expected fixed issuer/audience as server-managed database settings or equivalent trusted configuration, but they must not be client-writable or inferred from an unverified token. A02 must mint only after validating the opaque customer session and must create a fresh per-request Supabase client; the token lifetime is at most five minutes.

Rotation publishes/imports the new public key before minting with the new `kid`, keeps the previous public key only for the maximum token lifetime plus clock-skew allowance, then removes it. Compromise response stops minting, revokes the key, rotates the opaque-session signing/encryption material if affected, reviews audit correlation IDs, and treats already minted tokens as exposed until expiry. Negative tests must cover wrong/missing `kid`, unknown/retired key, wrong `iss`/`aud`, `alg=none`/algorithm confusion, wrong `principal_type`, admin/customer token substitution, malformed/non-UUID `sub`, future `nbf`, expired/overlong `exp`, excessive clock skew, and any browser/log/cache appearance.

## Authoritative references consulted

- [LINE webhook signature verification](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/): raw body, `x-line-signature`, HMAC-SHA256, and reject-before-parse.
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control): policies and service-key RLS bypass.
- [Supabase private bucket behavior](https://supabase.com/docs/guides/storage/buckets/fundamentals).
- [Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa): `aal2` enforcement.
