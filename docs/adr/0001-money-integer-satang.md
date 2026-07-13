# ADR-0001: Money uses integer satang

- Status: Accepted for implementation; Finance confirmation required before release
- Date: 2026-07-13

Store and transport THB amounts as signed 64-bit integer satang; TypeScript/API values are safe integers and validated against the documented maximum. Never use binary floating point for calculation. Persist immutable daily-rate, deposit, fee and total snapshots on the rental/payment records. Formatting to baht is presentation-only.

This makes equality, idempotency and reconciliation deterministic. A01 must use `bigint` or an equivalently constrained integer representation and document its generated TypeScript mapping.
