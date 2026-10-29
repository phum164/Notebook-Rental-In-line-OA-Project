import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminApi } from "../../src/components/admin/adapters/admin-api";

const id = "30000000-0000-4000-8000-000000000001";
const refundId = "40000000-0000-4000-8000-000000000001";
const evidenceId = "50000000-0000-4000-8000-000000000001";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const laptop = { id, name: "Synthetic notebook", specs: {}, status: "MAINTENANCE", dailyRateSatang: 10000, depositSatang: 50000, version: 3, retiredAt: null };
const summary = {
  rentalId: id, version: 9, depositSatang: 50000,
  fees: [{ id: evidenceId, type: "DAMAGE_FEE", amountSatang: 37655, reason: "ตรวจพบความเสียหาย" }],
  disposition: { inspectionId: evidenceId, kind: "ITEMIZED", feeTotalSatang: 37655, refundableSatang: 12345, reason: "สรุปตามผลตรวจสภาพ" },
  refunds: [{ id: refundId, status: "PENDING", amountSatang: 12345, providerReference: null, completedAt: null }],
};

afterEach(() => vi.unstubAllGlobals());

describe("admin completion workflows", () => {
  it("sends maintenance reason and current version", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json(laptop));
    const api = new AdminApi(fetcher, () => "csrf-token");
    await expect(api.setLaptopStatus(id, "MAINTENANCE", "ตรวจอุปกรณ์ก่อนให้เช่า", 2)).resolves.toMatchObject({ status: "MAINTENANCE", version: 3 });
    expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/v1/admin/laptops/${id}/status`);
    const request = fetcher.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({ status: "MAINTENANCE", reason: "ตรวจอุปกรณ์ก่อนให้เช่า" });
    expect(new Headers(request?.headers).get("if-match")).toBe('"2"');
  });

  it("uploads a product image bound to the laptop then attaches only finalized evidence", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ uploadId: refundId, method: "PUT", uploadUrl: "https://upload.test/product", headers: {} }, 201))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(json({ evidenceId, status: "READY" }, 201))
      .mockResolvedValueOnce(json(laptop));
    const api = new AdminApi(fetcher, () => "csrf-token");
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "product.jpg", { type: "image/jpeg" });
    const readyId = await api.uploadProductEvidence(id, file);
    await api.attachLaptopImage(id, readyId, "ด้านหน้าเครื่อง", 2);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ purpose: "LAPTOP_PRODUCT", targetId: id });
    expect(fetcher.mock.calls[1]?.[1]?.credentials).toBe("omit");
    expect(fetcher.mock.calls[3]?.[0]).toBe(`/api/v1/admin/laptops/${id}/images`);
    expect(JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body))).toEqual({ evidenceId, altText: "ด้านหน้าเครื่อง" });
    expect(new Headers(fetcher.mock.calls[3]?.[1]?.headers).get("if-match")).toBe('"2"');
  });

  it("uses the immutable server financial summary and confirms the exact obligation", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(summary)).mockResolvedValueOnce(json({ ...summary, refunds: [{ ...summary.refunds[0], status: "COMPLETED", providerReference: "BANK-001", completedAt: "2026-10-26T10:00:00Z" }] }));
    const api = new AdminApi(fetcher, () => "csrf-token");
    const current = await api.getFinancialSummary(id);
    expect(current.disposition?.refundableSatang).toBe(12345);
    const refund = current.refunds[0]!;
    await expect(api.confirmRefund(id, refund.id, { amountSatang: refund.amountSatang, providerReference: "BANK-001", reason: "ตรวจหลักฐานการโอนแล้ว" }, current.version)).resolves.toMatchObject({ refunds: [{ status: "COMPLETED", amountSatang: 12345 }] });
    expect(fetcher.mock.calls[1]?.[0]).toBe(`/api/v1/admin/rentals/${id}/refunds/${refundId}/confirm`);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({ amountSatang: 12345, providerReference: "BANK-001", reason: "ตรวจหลักฐานการโอนแล้ว" });
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("if-match")).toBe('"9"');
  });

  it("does not accept malformed server financial amounts", async () => {
    const api = new AdminApi(async () => json({ ...summary, depositSatang: 0.1 }));
    await expect(api.getFinancialSummary(id)).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("keeps request-return actionable and sends the selected inspection with its reason", async () => {
    const money = { amountSatang: 50000, currency: "THB" };
    const rental = {
      rental: { id, laptopId: id, status: "ACTIVE", startDate: "2026-11-01", endDate: "2026-11-03", rentalSubtotal: money, deposit: money, totalDue: money, version: 4, createdAt: "2026-10-26T10:00:00Z", updatedAt: "2026-10-26T10:00:00Z" },
      customerSummary: { displayName: "Synthetic customer", phoneMasked: "******1234" },
      reviewSummary: { kycStatus: "VERIFIED", kycEvidenceIds: [], paymentStatus: "VERIFIED", paymentAttemptId: null, paymentEvidenceId: null, beforeInspectionComplete: true, afterInspectionComplete: false },
      allowedCommands: ["request-return"],
    };
    const fetcher = vi.fn<typeof fetch>(async () => json(rental));
    const api = new AdminApi(fetcher, () => "csrf-token");
    await expect(api.getRental(id)).resolves.toMatchObject({ allowedCommands: ["request-return"] });
    await api.command(id, "finalize-inspection", 4, { inspectionId: evidenceId, reason: "สภาพเรียบร้อย ไม่มีค่าธรรมเนียม" });
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({ inspectionId: evidenceId, reason: "สภาพเรียบร้อย ไม่มีค่าธรรมเนียม" });
  });

  it("binds pending MFA challenge and verification to its separate CSRF cookie", async () => {
    vi.stubGlobal("document", { cookie: "nr_admin_csrf=unrelated; nr_admin_mfa_csrf=pending-csrf" });
    const fetcher = vi.fn().mockResolvedValueOnce(json({ challengeId: id, expiresAt: "2026-10-26T10:05:00Z" })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = new AdminApi(fetcher);
    const challenge = await api.startMfaChallenge();
    await api.verifyMfa(challenge.challengeId, "123456");
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/v1/admin/auth/mfa/challenge");
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/v1/admin/auth/mfa/verify");
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({ challengeId: id, code: "123456" });
    for (const call of fetcher.mock.calls) {
      expect(call[1]?.credentials).toBe("same-origin");
      expect(new Headers(call[1]?.headers).get("x-csrf-token")).toBe("pending-csrf");
    }
  });

  it("fails expired pending MFA locally and validates a six-digit code", async () => {
    vi.stubGlobal("document", { cookie: "" });
    const fetcher = vi.fn();
    const api = new AdminApi(fetcher);
    await expect(api.startMfaChallenge()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(api.verifyMfa(id, "12345")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
