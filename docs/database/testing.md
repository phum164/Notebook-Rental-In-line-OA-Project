# Database verification

## Full local verification

Prerequisites: Supabase CLI plus a running Docker-compatible engine.

```sh
supabase db reset
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/database/foundation.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/database/overlap.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/rls/access.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/rls/storage.sql
supabase gen types typescript --local > generated.tmp
```

Run the two-session procedure in `tests/database/overlap-concurrency.md` for the blocking proof. Gateway integration must additionally reject wrong/unknown/retired `kid`, `alg=none` or algorithm confusion, invalid signature, wrong issuer/audience/principal type, malformed subject, future `nbf`, expired token, and customer/admin token substitution. SQL validates claims after the trusted gateway verifies the JWT header/signature; PostgreSQL policies do not introspect JOSE headers.

## Forward-fix and rollback policy

Applied production migrations are never edited or rolled back destructively. A defect receives a new forward migration. Before production there must be a restore rehearsal from the latest backup into an isolated environment, followed by all constraint/RLS tests and aggregate integrity checks. A destructive down migration is intentionally not provided because core rental, audit and evidence history must not be erased.

