import { describe, expect, it, vi } from "vitest";

import { AdminApi } from "../../src/components/admin/adapters/admin-api";
import { CustomerApi } from "../../src/lib/liff/customer-adapter";
import { handleApiRequest } from "../../src/lib/server/api-router";
import { adminCsrfToken, sha256 } from "../../src/lib/server/security";
import { SupabaseApiOperations, type SupabaseApiConfig } from "../../src/services/supabase-api-operations";

// Real UI adapters, HTTP validation/session selection and persistence adapter; only provider transport/signing is injected.
const origin = "https://rental.example";
const now = new Date("2026-10-29T10:00:00.000Z");
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const customerId = id(1), adminId = id(2), rentalId = id(3), laptopId = id(4), quoteId = id(5);
const evidenceId = id(6), uploadId = id(7), inspectionId = id(8), refundId = id(9), paymentId = id(10);
const sessionSecret = "synthetic-session-secret-for-independent-qa-only";
const adminToken = `synthetic.${Buffer.from(JSON.stringify({ exp: now.getTime() / 1000 + 3600 })).toString("base64url")}.test`;
const customerCsrf = "synthetic-customer-csrf";
const adminCsrf = adminCsrfToken(sessionSecret, adminId, adminToken);
const bothCookies = `nr_customer_session=synthetic-customer; nr_csrf=${customerCsrf}; nr_admin_session=${adminToken}; nr_admin_csrf=${adminCsrf}`;
const config: SupabaseApiConfig = {
  supabaseUrl: "https://synthetic.supabase.co", publishableKey: "synthetic-publishable-key", appUrl: origin,
  lineChannelId: "synthetic-channel", sessionSecret, jwtPrivateKey: "synthetic-signing-key",
  jwtKeyId: "synthetic-key", jwtIssuer: origin, jwtAudience: "authenticated", allowBasicUploadScan: true,
};
const money = (amountSatang: number) => ({ amountSatang, currency: "THB" });
const rental = (status = "PENDING_PAYMENT", version = 1) => ({
  id: rentalId, laptopId, startDate: "2026-11-01", endDate: "2026-11-01", status, version,
  rentalSubtotal: money(12_345), deposit: money(50_000), totalDue: money(62_345),
  holdExpiresAt: "2099-11-01T10:30:00.000Z", createdAt: now.toISOString(), updatedAt: now.toISOString(),
});
const contract = { id: id(11), version: 1, title: "Synthetic contract", content: "Test terms only", contentHash: "a".repeat(64), effectiveAt: now.toISOString() };
const adminRental = (status: string, version: number) => ({
  rental: rental(status, version), customerSummary: { displayName: "Synthetic customer", phoneMasked: "***0000" },
  reviewSummary: { kycStatus: "VERIFIED", kycEvidenceIds: [evidenceId], paymentStatus: "VERIFIED", paymentAttemptId: paymentId,
    paymentEvidenceId: evidenceId, beforeInspectionComplete: true, afterInspectionComplete: true },
  allowedCommands: [],
});
const financial = (status = "PENDING", version = 11) => ({
  rentalId, version, depositSatang: 50_000,
  fees: [{ id: id(12), type: "DAMAGE_FEE", amountSatang: 10_000, reason: "Synthetic disposition" }],
  disposition: { inspectionId, kind: "ITEMIZED", feeTotalSatang: 10_000, refundableSatang: 40_000, reason: "Synthetic disposition" },
  refunds: [{ id: refundId, status, amountSatang: 40_000, providerReference: status === "COMPLETED" ? "synthetic-transfer" : null, completedAt: status === "COMPLETED" ? now.toISOString() : null }],
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
type Step = { name: string; body: unknown; status?: number; args?: Record<string, unknown>; bearer?: string };

function harness(options: { role?: string; mfaAt?: string; cookie?: string; customerValid?: boolean } = {}) {
  const steps: Step[] = [];
  const calls: { name: string; args: Record<string, unknown>; bearer: string | null }[] = [];
  const uploads: RequestInit[] = [];
  const jwt = vi.fn((claims: Record<string, unknown>) => `synthetic-${claims.role}-${claims.scope ?? claims.sub}`);
  const providerFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const name = url.pathname.split("/").at(-1)!;
    const args = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    const bearer = new Headers(init?.headers).get("authorization");
    calls.push({ name, args, bearer });
    if (name === "app_resolve_session") return json({ valid: options.customerValid !== false, customerId, sessionId: id(13), csrfHash: sha256(customerCsrf) });
    if (name === "get_admin_session") return json({ id: adminId, roles: [options.role ?? "OWNER"], mfaVerified: true, mfaVerifiedAt: options.mfaAt ?? now.toISOString() });
    const step = steps.shift();
    expect(step, `Unexpected provider request ${url.pathname}`).toBeDefined();
    expect(name).toBe(step!.name);
    if (step!.args) expect(args).toMatchObject(step!.args);
    if (step!.bearer) expect(bearer).toBe(`Bearer ${step!.bearer}`);
    return step!.body instanceof Uint8Array ? new Response(new Uint8Array(step!.body).buffer) : json(step!.body, step!.status);
  });
  const operations = new SupabaseApiOperations(config, { fetch: providerFetch as typeof fetch, now: () => now, jwt, token: () => "synthetic-random-token", uuid: () => id(14) });
  const request = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("cookie", options.cookie ?? bothCookies);
    headers.set("origin", origin);
    return handleApiRequest(new Request(new URL(path, origin), { ...init, headers }), {
      operations, now: () => now, trustedOrigins: new Set([origin]), requestId: () => "synthetic-qa-request",
    });
  };
  const browserFetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (String(input).startsWith(config.supabaseUrl!)) {
      expect(init?.method).toBe("PUT");
      expect(init?.credentials).toBe("omit");
      expect(new Headers(init.headers).has("cookie")).toBe(false);
      expect(new Headers(init.headers).has("x-csrf-token")).toBe(false);
      uploads.push(init);
      return new Response(null, { status: 200 });
    }
    return request(String(input), init);
  }) as typeof fetch;
  let sequence = 0;
  return {
    request, calls, jwt, uploads,
    enqueue: (...items: Step[]) => { steps.push(...items); },
    done: () => expect(steps).toHaveLength(0),
    customer: new CustomerApi(browserFetch, undefined, () => customerCsrf, () => `qa-customer-idempotency-${++sequence}`),
    admin: new AdminApi(browserFetch, () => adminCsrf, () => `qa-admin-idempotency-${++sequence}`),
  };
}

describe("A06 independent local composed HTTP acceptance (not live provider E2E)", () => {
  it("composes both UI clients through booking, immutable acceptance, review, handover, return and exact settlement", async () => {
    const h = harness();
    h.enqueue({ name: "create_rental_quote", args: { p_laptop_id: laptopId, p_start_date: "2026-11-01", p_end_date: "2026-11-01" }, body: {
      quoteId, laptopId, startDate: "2026-11-01", endDate: "2026-11-01", rentalDays: 1, dailyRate: money(12_345), rentalSubtotal: money(12_345), deposit: money(50_000), totalDue: money(62_345), expiresAt: "2026-10-29T10:05:00.000Z",
    } });
    expect((await h.customer.createQuote(laptopId, "2026-11-01", "2026-11-01")).totalDue.amountSatang).toBe(62_345);
    h.enqueue({ name: "create_rental_from_quote", args: { p_quote_id: quoteId, p_customer_name: "Synthetic customer", p_customer_phone: "0800000000" }, body: rental() });
    expect((await h.customer.createRental(quoteId, { name: "Synthetic customer", phone: "0800000000" })).status).toBe("PENDING_PAYMENT");
    h.enqueue({ name: "accept_rental_contract", args: { p_rental_id: rentalId, p_contract_version_id: contract.id, p_content_hash: contract.contentHash }, body: { accepted: true } });
    await h.customer.acceptContract(rentalId, contract);
    h.enqueue({ name: "submit_rental_payment", args: { p_rental_id: rentalId, p_evidence_id: evidenceId, p_payment_type: "RENT_AND_DEPOSIT" }, body: { id: paymentId } });
    await h.customer.submitPayment(rentalId, evidenceId);
    expect((await h.admin.getContext()).roles).toEqual(["OWNER"]);
    h.enqueue({ name: "verify_rental_kyc", args: { p_evidence_ids: [evidenceId], p_expected_version: 2 }, body: adminRental("PENDING_REVIEW", 3) });
    await h.admin.reviewKyc(rentalId, "verify", [evidenceId], 2);
    h.enqueue({ name: "verify_rental_payment", args: { p_payment_id: paymentId, p_provider_reference: "synthetic-payment", p_expected_version: 3 }, body: adminRental("PENDING_REVIEW", 4) });
    await h.admin.reviewPayment(rentalId, paymentId, "verify", 3, { reason: "Synthetic review", providerReference: "synthetic-payment" });
    let version = 4;
    for (const [command, status] of [["approve", "APPROVED"], ["start-preparation", "PREPARING"], ["mark-ready", "READY_FOR_HANDOVER"], ["handover", "ACTIVE"], ["request-return", "RETURN_PENDING"], ["receive-return", "INSPECTION_PENDING"]] as const) {
      h.enqueue({ name: "execute_rental_command", args: { p_rental_id: rentalId, p_command: command, p_expected_version: version }, body: adminRental(status, version + 1) });
      expect((await h.admin.command(rentalId, command, version++, { reason: "Synthetic operator reason" })).status).toBe(status);
      if (status === "PREPARING") {
        h.enqueue({ name: "create_rental_inspection", args: { p_type: "BEFORE_RENT", p_evidence_ids: [evidenceId] }, body: { id: id(15), type: "BEFORE_RENT", notes: "Synthetic before condition", evidenceIds: [evidenceId], finalizedAt: now.toISOString() } });
        await h.admin.createInspection(rentalId, { type: "BEFORE_RENT", evidenceIds: [evidenceId], notes: "Synthetic before condition" });
      }
    }
    h.enqueue({ name: "create_rental_inspection", args: { p_type: "AFTER_RETURN", p_evidence_ids: [evidenceId] }, body: { id: inspectionId, type: "AFTER_RETURN", notes: "Synthetic condition", evidenceIds: [evidenceId], finalizedAt: now.toISOString() } });
    await h.admin.createInspection(rentalId, { type: "AFTER_RETURN", evidenceIds: [evidenceId], notes: "Synthetic condition" });
    h.enqueue({ name: "create_rental_fee_obligation", args: { p_type: "DAMAGE_FEE", p_amount_satang: 10_000, p_reason: "Synthetic disposition" }, body: { id: id(12) } });
    await h.admin.createFee(rentalId, { type: "DAMAGE_FEE", amountSatang: 10_000, reason: "Synthetic disposition" });
    h.enqueue({ name: "execute_rental_command", args: { p_command: "finalize-inspection", p_inspection_id: inspectionId, p_expected_version: version }, body: adminRental("REFUND_PENDING", ++version) });
    await h.admin.command(rentalId, "finalize-inspection", version - 1, { inspectionId, reason: "Synthetic disposition" });
    h.enqueue({ name: "get_rental_financial_summary", body: financial("PENDING", version) });
    const summary = await h.admin.getFinancialSummary(rentalId);
    h.enqueue({ name: "confirm_rental_refund", args: { p_rental_id: rentalId, p_refund_id: refundId, p_amount_satang: summary.refunds[0]!.amountSatang, p_expected_version: summary.version, p_provider_reference: "synthetic-transfer" }, body: financial("COMPLETED", version + 1) });
    const confirmed = await h.admin.confirmRefund(rentalId, refundId, { amountSatang: summary.refunds[0]!.amountSatang, providerReference: "synthetic-transfer", reason: "Operator confirms transfer already performed" }, summary.version);
    h.enqueue({ name: "execute_rental_command", args: { p_command: "complete-settlement", p_expected_version: confirmed.version }, body: adminRental("COMPLETED", confirmed.version + 1) });
    expect((await h.admin.command(rentalId, "complete-settlement", confirmed.version)).status).toBe("COMPLETED");
    for (const call of h.calls.filter((call) => !["app_resolve_session", "get_admin_session"].includes(call.name))) {
      const customerCall = ["create_rental_quote", "create_rental_from_quote", "accept_rental_contract", "submit_rental_payment"].includes(call.name);
      expect(call.bearer).toBe(`Bearer ${customerCall ? `synthetic-authenticated-${customerId}` : adminToken}`);
      if (call.args.p_idempotency_key) expect(call.args.p_request_hash).toMatch(/^[a-f0-9]{64}$/);
    }
    h.done();
  });

  it.each(["customer", "admin"] as const)("composes a complete %s upload with both cookies without transferring session authority to Storage", async (kind) => {
    const h = harness();
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const bucketId = kind === "customer" ? "kyc-private" : "condition-private";
    const purpose = kind === "customer" ? "KYC_ID" : "CONDITION_AFTER";
    const bearer = kind === "customer" ? `synthetic-authenticated-${customerId}` : adminToken;
    h.enqueue(
      { name: "create_upload_intent_record", bearer, args: { p_purpose: purpose, p_target_id: rentalId, p_size_bytes: 8, p_mime_type: "image/png" }, body: { uploadId, bucketId, objectKey: "synthetic/object.png", expiresAt: now.toISOString() } },
      { name: "object.png", bearer, body: { url: `/object/upload/sign/${bucketId}/synthetic/object.png?token=synthetic` } },
      { name: "authorize_upload_scan", bearer, args: { p_upload_id: uploadId }, body: { bucketId, objectKey: "synthetic/object.png", declaredMimeType: "image/png", sizeBytes: 8 } },
      { name: "object.png", bearer: "synthetic-app_upload_scanner-upload:scan", body: png },
      { name: "finalize_upload_intent_record", bearer: "synthetic-app_upload_scanner-upload:scan", args: { p_upload_id: uploadId, p_detected_size_bytes: 8, p_detected_mime_type: "image/png", p_scan_result: "CLEAN", p_content_sha256: sha256(png) }, body: { evidenceId, status: "READY" } },
    );
    const file = new File([png], "synthetic.png", { type: "image/png" });
    if (kind === "customer") expect(await h.customer.uploadEvidence("KYC_ID", rentalId, file)).toEqual({ evidenceId, status: "READY" });
    else expect(await h.admin.uploadConditionEvidence(rentalId, "CONDITION_AFTER", file)).toBe(evidenceId);
    expect(h.uploads).toHaveLength(1);
    h.done();
  });

  it("preserves public settings and catalog asset normalization through the customer adapter", async () => {
    const h = harness();
    h.enqueue({ name: "get_customer_public_settings", body: { contactLineUrl: "https://line.me/R/ti/p/@synthetic" } },
      { name: "get_public_laptop", body: { id: laptopId, name: "Synthetic notebook", dailyRate: money(12_345), deposit: money(50_000), specs: { cpu: "Synthetic" }, thumbnailUrl: "/storage/v1/object/public/laptop-public/synthetic.png", imageUrls: ["/storage/v1/object/public/laptop-public/synthetic.png"] } });
    expect((await h.customer.getPublicSettings()).contactLineUrl).toBe("https://line.me/R/ti/p/@synthetic");
    const laptop = await h.customer.getLaptop(laptopId);
    expect(laptop.thumbnailUrl).toBe("https://synthetic.supabase.co/storage/v1/object/public/laptop-public/synthetic.png");
    expect(laptop.imageUrls).toEqual([laptop.thumbnailUrl]);
    expect(h.calls.some((call) => call.name === "app_resolve_session" || call.name === "get_admin_session")).toBe(false);
    h.done();
  });

  it("resumes the accepted immutable contract and unused slip without fetching a later contract or uploading again", async () => {
    const h = harness();
    h.enqueue({ name: "get_own_rental", body: { ...rental(), completionSummary: { kycReady: true, paymentStatus: "REJECTED", paymentEvidenceId: evidenceId, acceptedContract: contract } } },
      { name: "get_payment_settings", body: { value: { qrImageUrl: "https://synthetic.supabase.co/storage/v1/object/public/laptop-public/qr.png", accountDisplayName: "Synthetic account" }, updatedAt: now.toISOString() } });
    const completion = await h.customer.getRentalCompletion(rentalId);
    expect(completion.contract).toEqual(contract);
    expect(completion.rental.completionSummary).toMatchObject({ kycReady: true, paymentEvidenceId: evidenceId });
    expect(h.calls.some((call) => /upload|contract/.test(call.name))).toBe(false);
    h.done();
  });

  it.each(["customer", "admin"] as const)("selects the %s session for shared upload finalization and never retries as the other identity", async (kind) => {
    const h = harness();
    h.enqueue({ name: "authorize_upload_scan", args: { p_upload_id: uploadId }, bearer: kind === "customer" ? `synthetic-authenticated-${customerId}` : adminToken,
      body: { code: "42501", message: "FORBIDDEN synthetic private database detail" }, status: 403 });
    const response = await h.request(`/api/v1/uploads/${uploadId}/finalize`, { method: "POST", headers: { "x-csrf-token": kind === "customer" ? customerCsrf : adminCsrf, "idempotency-key": "qa-upload-finalize" } });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("private database detail");
    expect(h.calls.filter((call) => call.name === "authorize_upload_scan")).toHaveLength(1);
    expect(h.jwt.mock.calls.some(([claims]) => claims.role === "app_upload_scanner")).toBe(false);
    h.done();
  });

  it.each(["VIEWER", "REVIEWER"])("denies %s financial mutation before the persistence RPC", async (role) => {
    const h = harness({ role });
    await expect(h.admin.confirmRefund(rentalId, refundId, { amountSatang: 40_000, providerReference: "synthetic-transfer", reason: "Synthetic reason" }, 11)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.calls.map((call) => call.name)).toEqual(["get_admin_session"]);
  });

  it("denies expired recent MFA before a refund or inspection mutation", async () => {
    const h = harness({ mfaAt: "2026-10-29T09:30:00.000Z" });
    await expect(h.admin.confirmRefund(rentalId, refundId, { amountSatang: 40_000, providerReference: "synthetic-transfer", reason: "Synthetic reason" }, 11)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(h.admin.command(rentalId, "finalize-inspection", 10, { inspectionId, reason: "Synthetic reason" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.calls.every((call) => call.name === "get_admin_session")).toBe(true);
  });

  it("does not substitute the admin session for an expired customer session", async () => {
    const h = harness({ customerValid: false });
    await expect(h.customer.getRental(rentalId)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(h.calls.map((call) => call.name)).toEqual(["app_resolve_session"]);
  });

  it.each([
    ["CONFLICT", "23505", "private stale version", 409],
    ["INVALID_TRANSITION", "22023", "INVALID_TRANSITION private balance", 422],
    ["IDEMPOTENCY_CONFLICT", "23505", "IDEMPOTENCY_CONFLICT private key", 409],
  ])("preserves %s from the DB without leaking its details", async (expected, code, message, status) => {
    const h = harness();
    h.enqueue({ name: "confirm_rental_refund", body: { code, message }, status: Number(status) });
    await expect(h.admin.confirmRefund(rentalId, refundId, { amountSatang: 40_000, providerReference: "synthetic-transfer", reason: "Synthetic reason" }, 11)).rejects.toMatchObject({ code: expected, message: expect.not.stringContaining("private") });
    h.done();
  });

  it("strictly rejects client identity, price and arbitrary status before any provider request", async () => {
    const h = harness();
    const response = await h.request("/api/v1/rentals", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": customerCsrf, "idempotency-key": "qa-tamper-booking" }, body: JSON.stringify({ quoteId, customer: { name: "Synthetic", phone: "0800000000" }, line_user_id: "forged", totalDueSatang: 1, status: "COMPLETED" }) });
    expect(response.status).toBe(422);
    expect(h.calls).toHaveLength(0);
  });
});
