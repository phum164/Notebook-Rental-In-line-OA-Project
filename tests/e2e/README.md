# A06 independent local HTTP integration and E2E plans

`integrated-http.test.ts` composes production CustomerApi/AdminApi → HTTP Request/Response router → SupabaseApiOperations. Only external provider transport/JWT signing are injected. It exercises lifecycle contract wiring, private upload namespace selection/ownership, resume, money, role/MFA, input and sanitized errors. It does not execute browser UI, actual PostgreSQL, real JWT verification or Storage/LINE/IdP/scanner services. Complementary actual SQL/race proof is attributed to A01 in the traceability matrix.

Run `pnpm exec vitest run tests/e2e`. If Windows sandbox SSR cache rename fails before collection, point TEMP/TMP at isolated workspace scratch and rerun; that is not an assertion failure.

`qa-plan.test.ts` is a Wave 1 static integrity check for the QA documents and synthetic fixture catalog. It is **not** a browser, API, RLS, Storage, JWT, concurrency, scanner, or LINE integration test.

No new runner/config/dependency was added. All addresses/objects/credentials in the injected fixture are synthetic and never contacted. No live environment URL, service-role key, real LINE subject, production PII or captured sensitive image belongs in fixtures.

Runtime suites must consume isolated environment variables supplied by A07, reset to deterministic synthetic state, use generated image bytes, redact traces/screenshots, and cite scenario IDs from `docs/testing/**`.

