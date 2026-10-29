import { describe, expect, it, vi } from "vitest";
import { AdminApi, validateConditionImages } from "../../src/components/admin/adapters/admin-api";

const rentalId = "30000000-0000-4000-8000-000000000001";
const uploadId = "40000000-0000-4000-8000-000000000001";
const evidenceId = "50000000-0000-4000-8000-000000000001";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const image = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "condition.png", { type: "image/png" });
const intent = { uploadId, method: "PUT", uploadUrl: "https://upload.test/condition", headers: { "x-upsert": "false" } };

describe("admin condition upload", () => {
  it.each(["CONDITION_BEFORE", "CONDITION_AFTER"] as const)("binds %s to the rental and finalizes a private upload", async (purpose) => {
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input: String(input), ...(init ? { init } : {}) });
      if (requests.length === 1) return json(intent, 201);
      if (requests.length === 2) return new Response(null, { status: 200 });
      return json({ evidenceId, status: "READY" }, 201);
    });
    const api = new AdminApi(fetcher, () => "csrf-token", () => "11111111-1111-4111-8111-111111111111");
    const file = image();
    await expect(api.uploadConditionEvidence(rentalId, purpose, file)).resolves.toBe(evidenceId);
    expect(requests.map((request) => request.input)).toEqual(["/api/v1/uploads/intents", intent.uploadUrl, `/api/v1/uploads/${uploadId}/finalize`]);
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({ purpose, targetId: rentalId, filename: file.name, mimeType: file.type, sizeBytes: file.size });
    expect(requests[1]!.init).toMatchObject({ method: "PUT", body: file, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
    const uploadHeaders = new Headers(requests[1]!.init?.headers);
    expect(uploadHeaders.get("x-csrf-token")).toBeNull();
    expect(uploadHeaders.get("authorization")).toBeNull();
    expect(uploadHeaders.get("content-type")).toBe("image/png");
    expect(new Headers(requests[2]!.init?.headers).get("x-csrf-token")).toBe("csrf-token");
  });

  it("does not finalize when the storage upload fails", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(intent, 201)).mockResolvedValueOnce(new Response(null, { status: 500 }));
    const api = new AdminApi(fetcher, () => "csrf-token");
    await expect(api.uploadConditionEvidence(rentalId, "CONDITION_BEFORE", image())).rejects.toMatchObject({ code: "UPLOAD_REJECTED" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not automatically repeat a non-idempotent upload-intent creation", async () => {
    const fetcher = vi.fn(async () => json({ error: { code: "INTERNAL_ERROR", message: "unavailable" } }, 503));
    const api = new AdminApi(fetcher, () => "csrf-token");
    await expect(api.uploadConditionEvidence(rentalId, "CONDITION_BEFORE", image())).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects quarantined evidence rather than adding it to an inspection", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(intent, 201)).mockResolvedValueOnce(new Response(null, { status: 200 })).mockResolvedValueOnce(json({ evidenceId, status: "QUARANTINED" }, 201));
    const api = new AdminApi(fetcher, () => "csrf-token");
    await expect(api.uploadConditionEvidence(rentalId, "CONDITION_AFTER", image())).rejects.toMatchObject({ code: "UPLOAD_REJECTED" });
  });

  it("validates image type, size and twelve-image limit before network access", async () => {
    const file = image();
    expect(() => validateConditionImages([file], 11)).not.toThrow();
    expect(() => validateConditionImages([file], 12)).toThrow("1–12");
    expect(() => validateConditionImages(Array.from({ length: 13 }, () => file))).toThrow("1–12");
    expect(() => validateConditionImages([{ name: "condition.png", type: "image/png", size: 10 * 1024 * 1024 + 1 }])).toThrow("10 MB");
    expect(() => validateConditionImages([{ name: "condition.png", type: "image/png", size: 0 }])).toThrow("10 MB");
    const fetcher = vi.fn();
    const api = new AdminApi(fetcher, () => "csrf-token");
    await expect(api.uploadConditionEvidence(rentalId, "CONDITION_BEFORE", new File(["invalid"], "condition.pdf", { type: "application/pdf" }))).rejects.toMatchObject({ code: "UPLOAD_REJECTED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
