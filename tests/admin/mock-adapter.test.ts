import { describe, expect, it, vi } from "vitest";
import { AdminApi } from "../../src/components/admin/adapters/admin-api";
import { previewLifetime } from "../../src/components/admin/secure-evidence-viewer";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const money = (amountSatang: number) => ({ amountSatang, currency: "THB" });
const rental = {
  rental: { id: "30000000-0000-4000-8000-000000000001", laptopId: "10000000-0000-4000-8000-000000000001", startDate: "2026-11-01", endDate: "2026-11-03", status: "PENDING_REVIEW", rentalSubtotal: money(30000), deposit: money(50000), totalDue: money(80000), version: 4, createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z" },
  customerSummary: { displayName: "ลูกค้า", phoneMasked: "******5678" },
  reviewSummary: { kycStatus: "PENDING", kycEvidenceIds: ["40000000-0000-4000-8000-000000000001"], paymentStatus: "SUBMITTED", paymentAttemptId: "50000000-0000-4000-8000-000000000001", paymentEvidenceId: "60000000-0000-4000-8000-000000000001", beforeInspectionComplete: false, afterInspectionComplete: false },
  allowedCommands: ["approve", "reject"],
};

describe("admin API adapter", () => {
  it("uses server session permissions and server-derived allowed commands", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ adminId: "70000000-0000-4000-8000-000000000001", roles: ["REVIEWER"], mfaVerified: true, permissions: ["rental:read", "rental:review"], expiresAt: "2026-10-26T12:00:00Z" }))
      .mockResolvedValueOnce(json([rental]));
    const api = new AdminApi(fetcher);
    await expect(api.getContext()).resolves.toMatchObject({ roles: ["REVIEWER"], permissions: ["rental:read", "rental:review"] });
    await expect(api.listRentals()).resolves.toMatchObject([{ status: "PENDING_REVIEW", allowedCommands: ["approve", "reject"] }]);
  });

  it("retries one unavailable mutation with the same CSRF, version and idempotency key", async () => {
    const requests: RequestInit[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => { requests.push(init!); return requests.length === 1 ? json({ error: { code: "INTERNAL_ERROR", message: "unavailable" } }, 503) : json(rental); });
    const api = new AdminApi(fetcher, () => "csrf-token", () => "11111111-1111-4111-8111-111111111111");
    await api.command(rental.rental.id, "approve", 4);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      const headers = new Headers(request.headers);
      expect(headers.get("x-csrf-token")).toBe("csrf-token");
      expect(headers.get("if-match")).toBe('"4"');
      expect(headers.get("idempotency-key")).toBe("11111111-1111-4111-8111-111111111111");
    }
  });

  it.each([[401, "AUTH_REQUIRED"], [403, "FORBIDDEN"]] as const)("maps HTTP %s authorization failures", async (status, code) => {
    const api = new AdminApi(async () => json({ error: { code, message: "denied", requestId: "req-1" } }, status));
    await expect(api.getContext()).rejects.toMatchObject({ code, requestId: "req-1" });
  });

  it("bounds private preview cleanup to sixty seconds", () => {
    const now = Date.parse("2026-10-26T00:00:00Z");
    expect(previewLifetime("2026-10-26T00:02:00Z", now)).toBe(60_000);
    expect(previewLifetime("2026-10-25T23:59:00Z", now)).toBe(0);
  });
});
