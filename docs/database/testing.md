# Database verification

## Full local verification

Prerequisites: Supabase CLI plus a running Docker-compatible engine.

```sh
supabase db reset
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/database/foundation.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/database/overlap.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/database/rpc-boundary.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/database/line-receipts.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/database/critical-workflow.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/database/timezone-boundary.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/database/upload-recovery.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/e2e/utc-instant.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/rls/access.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/rls/storage.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/rls/storage-intent.sql
supabase gen types typescript --local > generated.tmp
```

Run the two-session procedure in `tests/database/overlap-concurrency.md` for the blocking proof. Gateway integration must additionally reject wrong/unknown/retired `kid`, `alg=none` or algorithm confusion, invalid signature, wrong issuer/audience/principal type, malformed subject, future `nbf`, expired token, and customer/admin token substitution. SQL validates claims after the trusted gateway verifies the JWT header/signature; PostgreSQL policies do not introspect JOSE headers.

## PostgreSQL compatibility harness

When Supabase/Docker is unavailable, create an isolated local PostgreSQL cluster and run `tests/database/postgres-compat-bootstrap.sql`, then all migrations in filename order, then `supabase/seed.sql`. The bootstrap supplies only the auth/storage SQL schemas needed to compile and execute database logic. It must never run against an existing Supabase project. It does not emulate JWT signature verification, the Auth provider, PostgREST or Storage HTTP behavior and is not live Supabase acceptance.

Local evidence on 2026-10-26: PostgreSQL 17 clean migrations 001–004 and seed pass. `foundation.sql`, `overlap.sql`, `rpc-boundary.sql`, RLS/access/storage/storage-intent and `line-receipts.sql` pass in the isolated compatibility harness. Receipt tests exercise exact service scopes, missing/null/wrong-type claims, duplicate/hash conflict, active lease exclusion, expired lease reclaim, stale completion, backoff, five-attempt dead-letter, execute-only grants and exact outbox recipient projection. Full Supabase PostgreSQL 15 reset and HTTP gateway/storage tests remain required for staging.

Local follow-up on 2026-10-29: clean migrations 001–005 plus seed and all eight SQL suites pass. `critical-workflow.sql` exercises the complete named-RPC booking → review → handover/ACTIVE → return → itemized disposition → exact manual refund confirmation → COMPLETED lifecycle, plus current/rejected KYC resume, unused/consumed/quarantined slips, immutable accepted contract, no-fee/zero-refund, wrong role, stale version, duplicate bank reference, immutable completed details, over-allocation, missing inspections/disposition/refund, replay and outbox fencing. Only synthetic identity/scanner fixtures support the main lifecycle; separately labeled negative/edge fixtures use direct setup inserts and roll back.

True two-connection booking evidence: run `booking-race-setup.sql`, launch `booking-race-a.sql` and wait until its backend is in `PgSleep`, then run `booking-race-b.sql` concurrently. B must visibly wait on `Lock/transactionid`, then exit 3 with SQLSTATE `23P01`/`CONFLICT`; A exits 0. Run `booking-race-assert.sql` to verify one booking/reservation/idempotency/audit/history/consumed quote and no losing-operation side effects. Use an isolated disposable database; setup is intentionally not rerunnable there.

Backup/restore evidence: custom-format `pg_dump` of the synthetic-only verification database → new empty local database → `pg_restore --exit-on-error` succeeded. `restore-invariants.sql` and the lifecycle, race-result, RLS/storage and receipt suites pass after restore; source/restored row counts match. This rehearses database schema/data/grants on the same local cluster, not cross-cluster role/secret recovery, Supabase storage objects or a measured production RTO/RPO. Exact commands, counts and clean shutdown are in `docs/agent-plan/handoffs/A01-critical-workflow-completion.md`.

QA forward-fix on 2026-10-29: under `Asia/Bangkok`, pre006 real customer defaults/update trigger were offset by -25200 seconds; after006 both offsets are zero. Independent A06 `utc-instant.sql` checks real customers/laptops in UTC/Bangkok/New York and all public instant defaults. `timezone-boundary.sql` changes UTC→Bangkok→UTC while checking server-created nonces/sessions, expiry, customer claim validation, quote instant and inclusive civil-date preservation. `upload-recovery.sql` confirms expired intent/negative scanner replacement, retained metadata and unchanged live-pending/READY KYC2/slip3 caps. New empty database `a01_qa006` compiled bootstrap→001–006→seed and passed all 11 runtime suites plus restore invariants. The existing storage-intent expiry fixture now explicitly places creation before expiry; it no longer depends on the old shifted default. Historical timestamp repair requires provenance and is not attempted. Exact before/after evidence and cleanup are in `docs/agent-plan/handoffs/A01-qa-timezone-fix.md`.

## Forward-fix and rollback policy

Applied production migrations are never edited or rolled back destructively. A defect receives a new forward migration. Before production there must be a restore rehearsal from the latest backup into an isolated environment, followed by all constraint/RLS tests and aggregate integrity checks. A destructive down migration is intentionally not provided because core rental, audit and evidence history must not be erased.
