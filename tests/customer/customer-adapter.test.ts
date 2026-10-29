import { describe, expect, it, vi } from "vitest";
import {
  CustomerApi, CustomerApiError, customerErrorMessage, formatBangkokDateTime, formatMoney,
  canCompleteRental, isPaymentSubmitted, validateCustomer, validateDateRange, validatePrivateImage,
} from "../../src/lib/liff/customer-adapter";
import { establishCustomerSession, loadBrowserLiff, type LiffClient } from "../../src/lib/liff/session";

const money = (amountSatang: number) => ({ amountSatang, currency: "THB" as const });
const rental = {
  id: "30000000-0000-4000-8000-000000000001", laptopId: "10000000-0000-4000-8000-000000000001",
  startDate: "2026-09-01", endDate: "2026-09-03", status: "PENDING_PAYMENT",
  rentalSubtotal: money(105_000), deposit: money(300_000), totalDue: money(405_000), holdExpiresAt: null,
  version: 1, createdAt: "2026-08-30T10:00:00Z", updatedAt: "2026-08-30T10:00:00Z",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const acceptedContract = { id: "60000000-0000-4000-8000-000000000001", version: 1, title: "สัญญาฉบับเดิม", content: "ข้อความที่ยอมรับจริง", contentHash: "a".repeat(64), effectiveAt: "2026-08-01T00:00:00Z" };
const evidenceId = "50000000-0000-4000-8000-000000000001";
const completionSummary = { kycReady: true, paymentStatus: "NOT_SUBMITTED", paymentEvidenceId: evidenceId, acceptedContract };

describe("customer API adapter", () => {
  it("establishes a server-verified LINE session without sending a client identity", async () => {
    const liff: LiffClient = { init: vi.fn(async () => undefined), isLoggedIn: () => true, login: vi.fn(), getAccessToken: () => "line-access-token-at-least-twenty" };
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return requests.length === 1 ? json({ nonce: "nonce-at-least-sixteen-characters" }, 201) : new Response(null, { status: 204 });
    });
    await establishCustomerSession(liff, "test-liff-id", fetcher);
    expect(liff.init).toHaveBeenCalledWith({ liffId: "test-liff-id" });
    expect(JSON.parse(String(requests[1]!.init?.body))).toEqual({ accessToken: "line-access-token-at-least-twenty", nonce: "nonce-at-least-sixteen-characters" });
    expect(String(requests[1]!.init?.body)).not.toContain("lineUserId");
  });

  it("parses server-authoritative catalog and quote values", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ data: [{ id: rental.laptopId, name: "ThinkPad", dailyRate: money(35_000), deposit: money(300_000), thumbnailUrl: "https://images.test/laptop.webp" }], page: { nextCursor: null, hasMore: false }, meta: {} }))
      .mockResolvedValueOnce(json({ quoteId: "20000000-0000-4000-8000-000000000001", laptopId: rental.laptopId, startDate: rental.startDate, endDate: rental.endDate, rentalDays: 3, dailyRate: money(35_000), rentalSubtotal: money(105_000), deposit: money(300_000), totalDue: money(405_000), expiresAt: "2026-08-30T10:10:00Z" }, 201));
    const api = new CustomerApi(fetcher, undefined, () => "csrf-token");
    expect((await api.listLaptops()).data[0]?.dailyRate.amountSatang).toBe(35_000);
    const quote = await api.createQuote(rental.laptopId, rental.startDate, rental.endDate);
    expect(quote.totalDue.amountSatang).toBe(405_000);
    const sent = JSON.parse(String(fetcher.mock.calls[1]![1]?.body));
    expect(sent).toEqual({ laptopId: rental.laptopId, startDate: rental.startDate, endDate: rental.endDate });
    expect(sent).not.toHaveProperty("totalDue");
  });

  it("rebootstraps an expired session once and preserves the mutation idempotency key", async () => {
    const requests: RequestInit[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init!);
      return requests.length === 1 ? json({ error: { code: "AUTH_REQUIRED", message: "expired", requestId: "r1" } }, 401) : json(rental, 201);
    });
    const reauthenticate = vi.fn(async () => undefined);
    const api = new CustomerApi(fetcher, reauthenticate, () => "csrf-token", () => "11111111-1111-4111-8111-111111111111");
    expect((await api.createRental("20000000-0000-4000-8000-000000000001", { name: "ลูกค้า", phone: "0812345678" })).status).toBe("PENDING_PAYMENT");
    expect(reauthenticate).toHaveBeenCalledTimes(1);
    expect(new Headers(requests[0]!.headers).get("idempotency-key")).toBe(new Headers(requests[1]!.headers).get("idempotency-key"));
    expect(new Headers(requests[1]!.headers).get("x-csrf-token")).toBe("csrf-token");
  });

  it("surfaces expired recovery when the single rebootstrap fails", async () => {
    const fetcher = vi.fn(async () => json({ error: { code: "AUTH_REQUIRED", message: "expired", requestId: "r1" } }, 401));
    const api = new CustomerApi(fetcher, async () => { throw new Error("provider unavailable"); }, () => "csrf-token");
    await expect(api.listRentals()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(api.listRentals()).rejects.toSatisfy((error: unknown) => customerErrorMessage(error).includes("เซสชันหมดอายุ"));
  });

  it("stops after a failed signed upload and never finalizes", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      if (calls.length === 1) return json({ uploadId: "40000000-0000-4000-8000-000000000001", method: "PUT", uploadUrl: "https://upload.test/object", headers: {}, expiresAt: "2026-08-30T10:05:00Z" }, 201);
      return new Response(null, { status: 500 });
    });
    const api = new CustomerApi(fetcher, undefined, () => "csrf-token");
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "kyc.png", { type: "image/png" });
    await expect(api.uploadEvidence("KYC_ID", rental.id, file)).rejects.toMatchObject({ code: "UPLOAD_REJECTED" });
    expect(calls).toEqual(["/api/v1/uploads/intents", "https://upload.test/object"]);
  });

  it("uploads to the one-object signed URL and finalizes an opaque evidence id", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      if (requests.length === 1) return json({ uploadId: "40000000-0000-4000-8000-000000000001", method: "PUT", uploadUrl: "https://upload.test/object", headers: { "x-upsert": "false" }, expiresAt: "2026-08-30T10:05:00Z" }, 201);
      if (requests.length === 2) return new Response(null, { status: 200 });
      return json({ evidenceId: "50000000-0000-4000-8000-000000000001", status: "READY" }, 201);
    });
    const api = new CustomerApi(fetcher, undefined, () => "csrf-token", () => "11111111-1111-4111-8111-111111111111");
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "slip.png", { type: "image/png" });
    await expect(api.uploadEvidence("PAYMENT_SLIP", rental.id, file)).resolves.toEqual({ evidenceId: "50000000-0000-4000-8000-000000000001", status: "READY" });
    expect(requests.map((item) => item.url)).toEqual(["/api/v1/uploads/intents", "https://upload.test/object", "/api/v1/uploads/40000000-0000-4000-8000-000000000001/finalize"]);
    expect(requests[1]!.init?.credentials).toBe("omit");
    expect(new Headers(requests[2]!.init?.headers).get("idempotency-key")).toHaveLength(36);
  });

  it("maps conflicts and rejects invalid forms, dates and files", async () => {
    const api = new CustomerApi(async () => json({ error: { code: "CONFLICT", message: "current state", requestId: "r2" } }, 409), undefined, () => "csrf-token");
    const error = await api.createQuote(rental.laptopId, rental.startDate, rental.endDate).catch((value) => value);
    expect(error).toBeInstanceOf(CustomerApiError);
    expect(error).toMatchObject({ code: "CONFLICT" });
    expect(customerErrorMessage(error)).toContain("เลือกวันใหม่");
    expect(validateCustomer("", "0812345678")).toBe(false);
    expect(validateCustomer("ลูกค้า", "0812345678")).toBe(true);
    expect(validateDateRange("2026-09-03", "2026-09-01", "2026-08-30")).toBe(false);
    expect(validatePrivateImage({ type: "application/pdf", size: 100 }).valid).toBe(false);
    expect(validatePrivateImage({ type: "image/png", size: 10 * 1024 * 1024 + 1 }).valid).toBe(false);
  });

  it("formats integer satang and UTC instants for Thailand", () => {
    expect(formatMoney(money(405_000))).toContain("4,050");
    expect(formatBangkokDateTime("2026-08-30T10:05:00Z")).toMatch(/17:05|17\.05/);
  });

  it.each(["https://line.me/R/ti/p/@shop", "https://lin.ee/shop"])("loads only the configured LINE contact: %s", async (url) => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => { expect(String(input)).toBe("/api/v1/public-settings"); return json({ contactLineUrl: url, privateSetting: "must-not-leak" }); });
    await expect(new CustomerApi(fetcher).getPublicSettings()).resolves.toEqual({ contactLineUrl: url });
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/v1/public-settings");
  });

  it("keeps an unconfigured contact explicitly unavailable", async () => {
    await expect(new CustomerApi(async () => json({ contactLineUrl: null })).getPublicSettings()).resolves.toEqual({ contactLineUrl: null });
  });

  it.each(["https://evil.test/", "https://line.me.evil.test/", "https://line.me@evil.test/", "https://user:pass@line.me/", "http://line.me/", "javascript:alert(1)", "https://line.me:444/", "/relative", undefined])("rejects unsafe or missing LINE contact: %s", async (url) => {
    await expect(new CustomerApi(async () => json({ contactLineUrl: url })).getPublicSettings()).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("resumes an owned rental using READY evidence and the exact accepted snapshot without reloading today's contract", async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return String(input).includes("/rentals/") ? json({ ...rental, completionSummary }) : json({ qrImageUrl: "https://images.test/qr.png", accountDisplayName: "ร้านเช่า", updatedAt: rental.updatedAt });
    });
    const result = await new CustomerApi(fetcher).getRentalCompletion(rental.id);
    expect(result.rental.completionSummary).toEqual(completionSummary);
    expect(result.contract).toEqual(acceptedContract);
    expect(urls).toEqual([`/api/v1/rentals/${rental.id}`, "/api/v1/payment-settings"]);
    expect(urls.some((url) => /uploads|contract-acceptance|contracts\/current/.test(url))).toBe(false);
  });

  it("loads a current contract only when the own rental has no accepted version", async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); urls.push(url);
      if (url.includes("/rentals/")) return json({ ...rental, completionSummary: { ...completionSummary, acceptedContract: null, kycReady: false } });
      if (url.includes("/contracts/current")) return json({ ...acceptedContract, version: 2 });
      return json({ qrImageUrl: "https://images.test/qr.png", accountDisplayName: "ร้านเช่า", updatedAt: rental.updatedAt });
    });
    const result = await new CustomerApi(fetcher).getRentalCompletion(rental.id);
    expect(result.contract?.version).toBe(2);
    expect(result.rental.completionSummary.acceptedContract).toBeNull();
    expect(urls).toContain("/api/v1/contracts/current");
  });

  it.each(["PENDING", "SUBMITTED", "VERIFIED"] as const)("restores %s as already submitted without exposing another payment action", async (paymentStatus) => {
    const fetcher = vi.fn(async () => json({ ...rental, status: "PENDING_REVIEW", completionSummary: { ...completionSummary, paymentStatus, paymentEvidenceId: null } }));
    const result = await new CustomerApi(fetcher).getRentalCompletion(rental.id);
    expect(isPaymentSubmitted(result.rental.completionSummary.paymentStatus)).toBe(true);
    expect(result.payment).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("requires a fresh slip for rejected payment rather than treating it as submitted", async () => {
    const result = await new CustomerApi(async (input) => String(input).includes("/rentals/")
      ? json({ ...rental, status: "PENDING_REVIEW", completionSummary: { ...completionSummary, paymentStatus: "REJECTED", paymentEvidenceId: null } })
      : json({ qrImageUrl: "https://images.test/qr.png", accountDisplayName: "ร้านเช่า", updatedAt: rental.updatedAt })).getRentalCompletion(rental.id);
    expect(isPaymentSubmitted(result.rental.completionSummary.paymentStatus)).toBe(false);
    expect(result.rental.completionSummary.paymentEvidenceId).toBeNull();
    expect(result.payment).not.toBeNull();
  });

  it("does not load payment actions for an expired hold or a terminal rental", async () => {
    for (const override of [{ holdExpiresAt: "2020-01-01T00:00:00Z" }, { status: "EXPIRED" }, { status: "COMPLETED" }]) {
      const fetcher = vi.fn(async () => json({ ...rental, ...override, completionSummary }));
      const result = await new CustomerApi(fetcher).getRentalCompletion(rental.id);
      expect(canCompleteRental(result.rental)).toBe(false);
      expect(result.payment).toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    const ownRental = await new CustomerApi(async () => json({ ...rental, completionSummary })).getRental(rental.id);
    expect(canCompleteRental({ ...ownRental, holdExpiresAt: "2026-09-01T10:00:00Z" }, Date.parse("2026-09-01T10:00:00Z"))).toBe(false);
    expect(canCompleteRental({ ...ownRental, holdExpiresAt: "invalid" })).toBe(false);
  });

  it.each([
    undefined, { ...completionSummary, kycReady: "true" }, { ...completionSummary, paymentStatus: "PAID" },
    { ...completionSummary, paymentEvidenceId: "https://private.test/object" },
    { ...completionSummary, acceptedContract: { ...acceptedContract, contentHash: "invalid" } },
  ])("rejects incomplete or malformed reload summaries without inventing readiness", async (summary) => {
    await expect(new CustomerApi(async () => json({ ...rental, completionSummary: summary })).getRental(rental.id)).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("preserves owner/session errors on resume and makes no fallback identity request", async () => {
    const fetcher = vi.fn(async () => json({ error: { code: "NOT_FOUND", message: "ไม่พบรายการ" } }, 404));
    await expect(new CustomerApi(fetcher).getRentalCompletion(rental.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("clears a rejected LIFF script promise so retry performs a new network load", async () => {
    type Script = { onload?: () => void; onerror?: () => void; remove: ReturnType<typeof vi.fn> };
    const scripts: Script[] = [];
    const browser: { liff?: LiffClient } = {};
    vi.stubGlobal("window", browser);
    vi.stubGlobal("document", { createElement: () => ({ remove: vi.fn() }), head: { append: (script: Script) => scripts.push(script) } });
    try {
      const failed = loadBrowserLiff();
      const rejection = expect(failed).rejects.toThrow("could not be loaded");
      scripts[0]!.onerror?.(); await rejection;
      expect(scripts[0]!.remove).toHaveBeenCalledOnce();
      const missingSdk = loadBrowserLiff();
      const missingRejection = expect(missingSdk).rejects.toThrow("did not initialize");
      scripts[1]!.onload?.(); await missingRejection;
      const retry = loadBrowserLiff();
      expect(loadBrowserLiff()).toBe(retry);
      expect(scripts).toHaveLength(3);
      browser.liff = { init: async () => undefined, isLoggedIn: () => true, login: () => undefined, getAccessToken: () => null };
      scripts[2]!.onload?.();
      await expect(retry).resolves.toBe(browser.liff);
    } finally { vi.unstubAllGlobals(); }
  });
});
