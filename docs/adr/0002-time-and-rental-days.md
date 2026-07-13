# ADR-0002: UTC instants and inclusive Bangkok rental dates

- Status: Provisional product assumption, expires 2026-08-15
- Date: 2026-07-13

Persist instants as timezone-aware UTC. Rental `start_date` and `end_date` are Bangkok civil dates and both are inclusive: rental days = calendar-day difference + 1, minimum one day. Default hold expiry is 30 minutes. Operational handover/return timestamps are instants and do not silently alter the contracted date range.

Product Owner must approve cutoff, minimum rental and late-fee policy before their production slice. Any change requires contract/schema test updates.
