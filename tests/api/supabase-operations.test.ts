import { describe, expect, it, vi } from "vitest";

import { OperationUnavailable, type AdminPrincipal, type CustomerPrincipal } from "../../src/services/api-operations";
import {
  SupabaseApiOperations,
  type SupabaseApiConfig,
  type SupabaseApiDependencies,
} from "../../src/services/supabase-api-operations";

const now = new Date("2026-08-30T10:00:00.000Z");
const config: SupabaseApiConfig = {
  supabaseUrl: "https://project.supabase.co",
  publishableKey: "publishable-test-key",
  appUrl: "https://rental.example",
  lineChannelId: "line-channel-1",
  sessionSecret: "session-secret-that-is-long-enough-for-tests",
  jwtPrivateKey: "test-private-key",
  jwtKeyId: "key-1",
  jwtIssuer: "https://rental.example",
  jwtAudience: "notebook-rental-db",
  allowBasicUploadScan: true,
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function dependencies(responses: Response[]): SupabaseApiDependencies & { fetch: ReturnType<typeof vi.fn>; jwt: ReturnType<typeof vi.fn> } {
  const jwt = vi.fn((claims: Record<string, unknown>) => `signed-${claims.role}-${claims.scope ?? "request"}`);
  return {
    fetch: vi.fn(async () => responses.shift() ?? json({ code: "unexpected" }, 500)),
    now: () => now,
    token: vi.fn(() => "A".repeat(43)),
    uuid: vi.fn(() => "90000000-0000-4000-8000-000000000001"),
    jwt,
  } as unknown as SupabaseApiDependencies & { fetch: ReturnType<typeof vi.fn>; jwt: ReturnType<typeof vi.fn> };
}

const customer: CustomerPrincipal = {
  kind: "customer",
  id: "10000000-0000-4000-8000-000000000001",
  dbToken: "customer-db-jwt",
  csrfHash: "a".repeat(64),
  sessionTokenHash: "b".repeat(64),
};

describe("Supabase normal-principal adapter", () => {
  it("issues a hash-only, browser-bound LINE bootstrap nonce", async () => {
    const deps = dependencies([json({ expiresAt: "2026-08-30T10:05:00.000Z" })]);
    const adapter = new SupabaseApiOperations(config, deps);
    const result = await adapter.execute("createLineBootstrap", {}, { requestId: "req-1", principal: null });
    const request = deps.fetch.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(request.body));

    expect(result).toMatchObject({ status: 201, body: { nonce: "A".repeat(43) } });
    expect(body).toMatchObject({ p_nonce_hash: expect.stringMatching(/^[a-f0-9]{64}$/), p_browser_binding_hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.stringify(body)).not.toContain("A".repeat(43));
    expect(new Headers(result.headers).get("set-cookie")).toContain("nr_line_bootstrap=");
    expect(deps.jwt.mock.calls[0]![0]).toMatchObject({ role: "app_session_service", scope: "session:bootstrap", exp: 1_788_084_060 });
  });

  it("verifies LINE with the expected channel then creates opaque session and CSRF cookies", async () => {
    const deps = dependencies([
      json({ client_id: "line-channel-1", expires_in: 600 }),
      json({ userId: "U-synthetic-subject", displayName: "Synthetic User" }),
      json({ sessionId: "50000000-0000-4000-8000-000000000001" }),
    ]);
    const adapter = new SupabaseApiOperations(config, deps);
    const result = await adapter.execute("createLineSession", {
      accessToken: "provider-access-token-for-test-only",
      nonce: "N".repeat(43),
      browserBinding: "B".repeat(43),
    }, { requestId: "req-2", principal: null });
    const rpcBody = JSON.parse(String((deps.fetch.mock.calls[2]![1] as RequestInit).body));

    expect(result.status).toBe(204);
    expect(rpcBody).toMatchObject({
      p_nonce_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_browser_binding_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_line_subject: "U-synthetic-subject",
      p_session_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_csrf_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(rpcBody)).not.toContain("provider-access-token-for-test-only");
    expect(new Headers(result.headers).get("set-cookie")).toContain("nr_customer_session=");
  });

  it("resolves an opaque session with scoped JWT then mints a short-lived customer DB JWT", async () => {
    const deps = dependencies([json({
      valid: true,
      sessionId: "50000000-0000-4000-8000-000000000001",
      customerId: customer.id,
      csrfHash: "c".repeat(64),
    })]);
    const adapter = new SupabaseApiOperations(config, deps);
    const principal = await adapter.resolveSession("customer", "opaque-session-token");

    expect(principal).toMatchObject({ kind: "customer", id: customer.id, csrfHash: "c".repeat(64) });
    expect(deps.jwt.mock.calls.map((call) => call[0])).toEqual([
      expect.objectContaining({ role: "app_session_service", scope: "session:resolve", exp: 1_788_084_060 }),
      expect.objectContaining({ role: "authenticated", principal_type: "customer", sub: customer.id, exp: 1_788_084_300 }),
    ]);
  });

  it("resolves an admin through get_admin_session and binds its CSRF token", async () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1_788_087_600 })).toString("base64url");
    const token = `header.${payload}.signature`;
    const deps = dependencies([json({ id: "90000000-0000-4000-8000-000000000001", roles: ["OWNER"], mfaVerified: true })]);
    const adapter = new SupabaseApiOperations(config, deps);
    const principal = await adapter.resolveSession("admin", token);
    const result = await adapter.execute("getAdminSession", {}, { requestId: "req-admin", principal });

    expect(principal).toMatchObject({ kind: "admin", roles: ["OWNER"], dbToken: token, csrfToken: expect.any(String) });
    expect(new Headers(result.headers).get("set-cookie")).toContain("nr_admin_csrf=");
    expect(String(deps.fetch.mock.calls[0]![0])).toContain("/rest/v1/rpc/get_admin_session");
  });

  it("maps idempotency conflicts without reflecting database details", async () => {
    const deps = dependencies([json({ code: "23505", message: "IDEMPOTENCY_CONFLICT sensitive db detail" }, 409)]);
    const adapter = new SupabaseApiOperations(config, deps);
    await expect(adapter.execute("createRental", {
      quoteId: "20000000-0000-4000-8000-000000000001",
      customer: { name: "Synthetic", phone: "0812345678" },
    }, { requestId: "req-3", principal: customer, idempotencyKey: "booking:0123456789" })).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      message: "Idempotency key conflicts with the original request",
    });
  });

  it("includes the expected version in the canonical idempotency hash", async () => {
    const deps = dependencies([json({ id: "laptop-1" }), json({ id: "laptop-1" })]);
    const adapter = new SupabaseApiOperations(config, deps);
    const input = { laptopId: "30000000-0000-4000-8000-000000000001", name: "Notebook", specs: {}, dailyRateSatang: 10_000, depositSatang: 20_000 };
    await adapter.execute("updateAdminLaptop", input, { requestId: "req-v1", principal: { kind: "admin", id: "admin", roles: ["OWNER"], mfaVerified: true, dbToken: "admin-token" }, idempotencyKey: "laptop:0123456789", ifMatch: "v1" });
    await adapter.execute("updateAdminLaptop", input, { requestId: "req-v2", principal: { kind: "admin", id: "admin", roles: ["OWNER"], mfaVerified: true, dbToken: "admin-token" }, idempotencyKey: "laptop:0123456789", ifMatch: "v2" });
    const bodies = deps.fetch.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)));
    expect(bodies[0].p_request_hash).not.toBe(bodies[1].p_request_hash);
  });

  it("creates private signed upload and read URLs through owner-authorized records", async () => {
    const admin: AdminPrincipal = { kind: "admin", id: "90000000-0000-4000-8000-000000000001", roles: ["OWNER"], mfaVerified: true, dbToken: "admin-token" };
    const deps = dependencies([
      json({ uploadId: "70000000-0000-4000-8000-000000000001", bucketId: "kyc-private", objectKey: "kyc/object.png", expiresAt: "2026-08-30T10:05:00.000Z" }, 201),
      json({ url: "/object/upload/sign/kyc-private/kyc/object.png?token=signed" }),
      json({ bucketId: "kyc-private", objectKey: "kyc/object.png" }),
      json({ signedURL: "/object/sign/kyc-private/kyc/object.png?token=signed" }),
    ]);
    const adapter = new SupabaseApiOperations(config, deps);
    const upload = await adapter.execute("createUploadIntent", { purpose: "KYC", targetId: "40000000-0000-4000-8000-000000000001", filename: "id.png", mimeType: "image/png", sizeBytes: 8 }, { requestId: "req-upload", principal: customer });
    const read = await adapter.execute("createEvidenceSignedRead", { evidenceId: "60000000-0000-4000-8000-000000000001" }, { requestId: "req-read", principal: admin });
    expect(upload.body).toMatchObject({ method: "PUT", uploadUrl: expect.stringContaining("/storage/v1/object/upload/sign/") });
    expect(read.body).toMatchObject({ readUrl: expect.stringContaining("/storage/v1/object/sign/"), expiresAt: expect.any(String) });
  });

  it("authorizes exact object scan, validates magic/size/hash, then finalizes as scanner", async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const deps = dependencies([
      json({ bucketId: "kyc-private", objectKey: "kyc/rental/object.png", declaredMimeType: "image/png", sizeBytes: png.byteLength }),
      new Response(png, { status: 200, headers: { "content-length": String(png.byteLength) } }),
      json({ evidenceId: "60000000-0000-4000-8000-000000000001", status: "READY" }, 201),
    ]);
    const adapter = new SupabaseApiOperations(config, deps);
    const result = await adapter.execute("finalizeUpload", { uploadId: "70000000-0000-4000-8000-000000000001" }, {
      requestId: "req-4", principal: customer, idempotencyKey: "upload:0123456789",
    });
    const scanRequest = deps.fetch.mock.calls[1]!;
    const finalizeBody = JSON.parse(String((deps.fetch.mock.calls[2]![1] as RequestInit).body));

    expect(result).toMatchObject({ status: 201, body: { status: "READY" } });
    expect(String(scanRequest[0])).toContain("/storage/v1/object/authenticated/kyc-private/kyc/rental/object.png");
    expect(new Headers((scanRequest[1] as RequestInit).headers).get("authorization")).toBe("Bearer signed-app_upload_scanner-upload:scan");
    expect(finalizeBody).toMatchObject({ p_detected_mime_type: "image/png", p_detected_size_bytes: 8, p_scan_result: "CLEAN" });
    expect(finalizeBody.p_content_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails closed for production upload finalization without an approved scanner", async () => {
    const deps = dependencies([]);
    const adapter = new SupabaseApiOperations({ ...config, allowBasicUploadScan: false }, deps);
    await expect(adapter.execute("finalizeUpload", { uploadId: "70000000-0000-4000-8000-000000000001" }, {
      requestId: "req-5", principal: customer, idempotencyKey: "upload:0123456789",
    })).rejects.toBeInstanceOf(OperationUnavailable);
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("does not scan or finalize when the selected principal does not own the upload", async () => {
    const deps = dependencies([json({ code: "42501", message: "FORBIDDEN" }, 403)]);
    const adapter = new SupabaseApiOperations(config, deps);
    await expect(adapter.execute("finalizeUpload", { uploadId: "70000000-0000-4000-8000-000000000001" }, {
      requestId: "req-upload-denied", principal: customer, idempotencyKey: "upload:0123456789",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    const authorization = deps.fetch.mock.calls[0]!;
    expect(String(authorization[0])).toContain("/rpc/authorize_upload_scan");
    expect(new Headers((authorization[1] as RequestInit).headers).get("authorization")).toBe("Bearer customer-db-jwt");
    expect(deps.jwt).not.toHaveBeenCalled();
  });

  it("uses scoped worker JWTs for post-commit outbox claim and completion", async () => {
    const deps = dependencies([json([{ id: "event-1" }]), json(true)]);
    const adapter = new SupabaseApiOperations(config, deps);
    expect(await adapter.claimOutbox()).toEqual([{ id: "event-1", recipientLineUserId: null }]);
    expect(await adapter.completeOutbox("80000000-0000-4000-8000-000000000001", "81000000-0000-4000-8000-000000000001", true)).toBe(true);
    expect(deps.jwt.mock.calls.map((call) => call[0])).toEqual([
      expect.objectContaining({ role: "app_outbox_worker", scope: "notification:deliver" }),
      expect.objectContaining({ role: "app_outbox_worker", scope: "notification:deliver" }),
    ]);
  });

  it("passes only normalized receipt metadata through exact scoped ingress and fenced worker RPCs", async () => {
    const deps = dependencies([json({ inserted: 1, duplicates: 0 }), json([{ id: "receipt-1", lease_token: "lease-1" }]), json(true)]);
    const adapter = new SupabaseApiOperations(config, deps);
    const events = [{ providerEventId: "synthetic-event", eventType: "follow", payloadHash: "a".repeat(64) }];
    expect(await adapter.persistLineWebhookReceipts(events)).toEqual({ inserted: 1, duplicates: 0 });
    expect(await adapter.claimLineWebhookReceipts(5)).toEqual([{ id: "receipt-1", lease_token: "lease-1" }]);
    expect(await adapter.completeLineWebhookReceipt("receipt-1", "lease-1", "IGNORED")).toBe(true);
    expect(deps.jwt.mock.calls.map((call) => call[0])).toEqual([
      expect.objectContaining({ role: "app_line_webhook_ingress", principal_type: "line_webhook_ingress", scope: "line:webhook:persist", exp: 1_788_084_060 }),
      expect.objectContaining({ role: "app_line_webhook_worker", principal_type: "line_webhook_worker", scope: "line:webhook:process", exp: 1_788_084_300 }),
      expect.objectContaining({ role: "app_line_webhook_worker", scope: "line:webhook:process" }),
    ]);
    const bodies = deps.fetch.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)));
    expect(bodies).toEqual([{ p_events: events }, { p_limit: 5 }, { p_receipt_id: "receipt-1", p_lease_token: "lease-1", p_outcome: "IGNORED", p_error_category: null, p_retry_after_seconds: 60 }]);
  });

  it("normalizes only the claimed notification recipient projection", async () => {
    const deps = dependencies([json([{ id: "event-1", recipient_line_user_id: "U-synthetic-recipient", recipient_customer_id: customer.id }])]);
    const adapter = new SupabaseApiOperations(config, deps);
    expect(await adapter.claimOutbox()).toEqual([{ id: "event-1", recipient_line_user_id: "U-synthetic-recipient", recipient_customer_id: customer.id, recipientLineUserId: "U-synthetic-recipient" }]);
    expect(deps.fetch.mock.calls).toHaveLength(1);
  });
  it("maps maintenance, image and refund confirmation to named versioned RPCs", async () => {
    const deps = dependencies([json({}), json({}), json({}), json({})]);
    const adapter = new SupabaseApiOperations(config, deps);
    const context = { requestId: "req-finish", principal: { kind: "admin" as const, id: "admin", roles: ["OWNER" as const], mfaVerified: true, dbToken: "admin-token" }, idempotencyKey: "finish:0123456789", ifMatch: '"4"' };
    await adapter.execute("setAdminLaptopStatus", { laptopId: "laptop", status: "MAINTENANCE", reason: "Repair" }, context);
    await adapter.execute("attachAdminLaptopImage", { laptopId: "laptop", evidenceId: "image", altText: "Device" }, context);
    await adapter.execute("getRentalFinancialSummary", { rentalId: "rental" }, context);
    await adapter.execute("confirmRentalRefund", { rentalId: "rental", refundId: "refund", amountSatang: 100, providerReference: "synthetic-reference", reason: "Bank transfer recorded" }, context);
    expect(deps.fetch.mock.calls.map((call) => String(call[0]).split("/").at(-1))).toEqual(["set_admin_laptop_status", "attach_admin_laptop_image", "get_rental_financial_summary", "confirm_rental_refund"]);
    const bodies = deps.fetch.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)));
    expect(bodies[0]).toMatchObject({ p_status: "MAINTENANCE", p_expected_version: 4 });
    expect(bodies[1]).toMatchObject({ p_evidence_id: "image", p_alt_text: "Device", p_expected_version: 4 });
    expect(bodies[3]).toMatchObject({ p_refund_id: "refund", p_amount_satang: 100, p_provider_reference: "synthetic-reference", p_expected_version: 4 });
  });

  it("converts storage-relative assets to the provider origin and exposes only allowlisted contact settings", async () => {
    const deps = dependencies([json({ id: "laptop", thumbnailUrl: "/storage/v1/object/public/laptop-public/image.png", imageUrls: ["/storage/v1/object/public/laptop-public/image.png"] }), json({ contactLineUrl: "https://lin.ee/synthetic" }), json({ contactLineUrl: "https://evil.test" })]);
    const adapter = new SupabaseApiOperations(config, deps);
    expect((await adapter.execute("getLaptop", { laptopId: "laptop" }, { requestId: "assets", principal: null })).body).toMatchObject({ thumbnailUrl: "https://project.supabase.co/storage/v1/object/public/laptop-public/image.png", imageUrls: ["https://project.supabase.co/storage/v1/object/public/laptop-public/image.png"] });
    expect((await adapter.execute("getCustomerPublicSettings", {}, { requestId: "public", principal: null })).body).toEqual({ contactLineUrl: "https://lin.ee/synthetic" });
    expect((await adapter.execute("getCustomerPublicSettings", {}, { requestId: "public", principal: null })).body).toEqual({ contactLineUrl: null });
  });
});
