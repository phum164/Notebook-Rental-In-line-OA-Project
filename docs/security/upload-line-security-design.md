# Secure Upload and LINE Integration Design

## Upload lifecycle

1. **Intent:** authenticate, authorize target/purpose/state, enforce per-purpose count and quota, validate declared filename/MIME/size, generate a random immutable key, and persist a one-use intent with short expiry (baseline 5 minutes).
2. **Direct upload:** return a single-object signed operation only. No bucket list, wildcard prefix, service key, overwrite/upsert, move/copy, or client-selected durable key.
3. **Finalize:** lock/consume intent idempotently; confirm exact object; stream with bounded resources; compare actual size and magic-byte detected type; decode to enforce pixel/dimension limits; strip metadata; scan/quarantine; create sanitized durable object or evidence metadata; delete/restrict original.
4. **Use:** consumers reference opaque evidence ID. Sensitive reads re-authorize case and role, issue one-object signed URL for at most 60 seconds, and audit the issuance without URL/key.
5. **Cleanup:** delete unfinalized/orphan originals after 24 hours, quarantine after 7 days unless incident hold requires longer, and durable objects according to the approved retention schedule/legal hold.

## File policy

| Purpose | Allowed detected formats | Max/file | Max count | Uploader | Reader after finalize |
|---|---|---:|---:|---|---|
| KYC | JPEG, PNG, WebP | 10 MiB | 2/rental | Own customer | Reviewer/Owner only |
| Payment slip | JPEG, PNG, WebP | 10 MiB | 3/payment attempt/rental scope | Own customer | Reviewer/Owner |
| Condition before/after | JPEG, PNG, WebP | 10 MiB | 12/stage | Operations/Owner | Operations/Owner |
| Product image | JPEG, PNG, WebP sanitized derivative | 10 MiB source | Product-configured | Operations/Owner | Public derivative |

Declared extension and MIME are hints only. Detected type must agree with both; reject truncated images, malformed decodes, files with executable/archive/document signatures, appended active content where the decoder reports trailing-risk, and dimensions/pixel count above a configured safe bound. Re-encode to a sanitized image, strip EXIF/XMP/ICC/GPS unless a documented display need exists, and never preserve the original filename for serving.

Scan results: `PENDING_SCAN`, `CLEAN`, `QUARANTINED`, `REJECTED`. Only `CLEAN` is eligible for durable use or signed read. If a malware scanner is unavailable, fail closed for production sensitive uploads; staging may use synthetic fixtures only and must display/record the degraded gate.

## LINE login and webhook controls

- LINE login follows `docs/security/auth-rbac-session-controls.md`; the server validates the credential and issues its own application session.
- The webhook handler reads exact raw UTF-8 bytes under a strict body limit. Before parsing, compute HMAC-SHA256 with the environment-specific channel secret and compare the base64 result to `x-line-signature` in constant time. Missing/invalid signature is rejected and creates only a redacted metric.
- Do not rely on source IP allowlisting because signature verification is the trust proof. Do not log or persist the raw body merely to debug signature failures.
- After verification and schema validation, persist a unique provider event/replay key and minimal normalized event in a durable receipt. Duplicate delivery returns success without repeating effects. Unsupported events are acknowledged after durable receipt when appropriate.
- Acknowledge promptly after durable receipt. Business work runs asynchronously with bounded retries; poison events move to a redacted dead-letter state visible to operators.

## Notification outbox

Domain transaction inserts an outbox event in the same commit; it never calls LINE before commit. Each event contains an allowlisted template/event type, recipient reference, minimum variables, correlation ID, attempt count, next-attempt time, and unique idempotency key. Raw tokens and arbitrary message bodies are forbidden.

Worker flow: atomically claim with lease → resolve current authorized recipient/template → send with server-only channel credential → record provider request correlation/status class → mark delivered. Retry 429/5xx/network failures with exponential backoff and jitter; respect provider retry guidance. Permanent 4xx/template/recipient errors become failed/dead-letter and alert. Lease expiry permits recovery, while the unique event/idempotency key prevents internal duplicate effects. Because external delivery may still be ambiguous after a timeout, templates must be safe to receive twice and monitoring must surface ambiguity.

Recipient lists, notification events, and fallback channel remain blocked on Owner/Ops decision D-13. No real notification integration may proceed before that approval and A02 post-commit hooks.

## Secret handling

LINE channel secret/access token, Supabase service/signing credentials, and session secrets are server-only, environment-separated, and injected by the deployment secret store. Preview/dev cannot reach production channels. Rotation uses dual-key overlap where provider support permits; suspected exposure triggers immediate revoke/rotate, session/receipt impact review, and the breach runbook.

## Required negative evidence

- Invalid/missing signature, modified whitespace/body bytes, wrong environment secret, oversized body, malformed JSON after valid signature, duplicate receipt, and retry recovery.
- Expired/consumed/wrong-target intent; wrong prefix; cross-user upload; MIME spoof/polyglot/malformed/oversize/dimension bomb; count exceeded; scanner failure; overwrite/delete/list denial; orphan cleanup.
- Signed read for anonymous/Viewer/wrong role/cross-case/quarantined/deleted/legal-hold state; TTL ≤60s and no-store/no-log proof.

