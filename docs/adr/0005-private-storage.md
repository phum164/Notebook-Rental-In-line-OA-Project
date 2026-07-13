# ADR-0005: Private evidence storage with intent-based access

- Status: Accepted baseline; limits provisional until A05/Product approval
- Date: 2026-07-13

KYC, slips and condition evidence live in separate private/default-deny storage classes. Clients obtain only a short-lived single-object upload intent and authorized signed read URL (baseline 60 seconds). Database rows store bucket/key metadata or opaque evidence IDs, never permanent signed URLs. Public access is allowed only for sanitized product images in a distinct bucket.

Finalize verifies ownership, purpose, size, magic bytes and allowlist; EXIF is stripped and suspicious files are quarantined. Logs and analytics exclude object keys, signed URLs and image-derived PII.
