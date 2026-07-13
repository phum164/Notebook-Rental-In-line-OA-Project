# A06 E2E scaffold

`qa-plan.test.ts` is a Wave 1 static integrity check for the QA documents and synthetic fixture catalog. It is **not** a browser, API, RLS, Storage, JWT, concurrency, scanner, or LINE integration test.

When A02–A05 hand off runnable slices, A06 will add tests in this directory using the A00-approved test runner/config lease. Until then, do not introduce a QA-owned Playwright/Vitest/config root, hard-coded environment URL, credential, service-role key, real LINE subject, production PII, object key, signed URL, or captured sensitive image.

Runtime suites must consume isolated environment variables supplied by A07, reset to deterministic synthetic state, use generated image bytes, redact traces/screenshots, and cite scenario IDs from `docs/testing/**`.

