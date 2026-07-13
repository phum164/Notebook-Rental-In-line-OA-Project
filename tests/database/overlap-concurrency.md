# Booking overlap concurrency proof

Run after a clean Supabase reset. Open two `psql` sessions against the same database and use the same laptop/customer IDs.

1. In session A, begin a transaction and insert a `PENDING_PAYMENT` rental for `2026-08-01..2026-08-03`; do not commit.
2. In session B, begin a transaction and insert a `PENDING_PAYMENT` rental for `2026-08-03..2026-08-04`.
3. Session B waits on the GiST exclusion check. Commit session A.
4. Session B fails with SQLSTATE `23P01` (`exclusion_violation`). Roll it back.
5. Repeat with A rolled back: session B succeeds.

The exclusion constraint on `rental_inventory_reservations (laptop_id WITH =, rental_dates WITH &&)` is the database arbiter. The `daterange(..., '[]')` constructor makes both rental endpoints inclusive. Application availability pre-checks do not affect this result.

