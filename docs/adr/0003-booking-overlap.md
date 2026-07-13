# ADR-0003: Database-enforced booking overlap prevention

- Status: Accepted baseline; A01 selects exact PostgreSQL mechanism
- Date: 2026-07-13

Statuses `PENDING_PAYMENT` with an unexpired hold, `PENDING_REVIEW`, `APPROVED`, `PREPARING`, `READY_FOR_HANDOVER`, `ACTIVE`, `RETURN_PENDING`, `INSPECTION_PENDING` and `REFUND_PENDING` block overlapping inclusive date ranges for the same laptop. Booking creation occurs in one transaction and the database is the final arbiter. Expired pending-payment holds do not block after durable expiry processing or an equivalent constraint predicate.

A01 may use an exclusion constraint plus normalized hold rows, or serializable/advisory locking with a constraint-compatible representation, but must prove concurrent attempts yield one success. Application pre-checks are UX only.
