import { afterEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  claimLineWebhookReceipts: vi.fn(async () => [{ id: "receipt-1", lease_token: "lease-1" }]),
  completeLineWebhookReceipt: vi.fn(async () => true),
  claimOutbox: vi.fn(async () => []),
  completeOutbox: vi.fn(async () => true),
}));
vi.mock("../../../src/services/supabase-api-operations", () => ({ runtimeSupabaseOperations: () => hooks }));
import { GET } from "../../../src/app/api/internal/line/route";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("LINE scheduler authorization", () => {
  it("rejects an absent or short server secret before claiming work", async () => {
    vi.stubEnv("CRON_SECRET", "short");
    expect((await GET(new Request("https://app.test/api/internal/line"))).status).toBe(503);
    expect(hooks.claimLineWebhookReceipts).not.toHaveBeenCalled();
  });
  it("rejects a wrong bearer token before claiming work", async () => {
    vi.stubEnv("CRON_SECRET", "s".repeat(32));
    expect((await GET(new Request("https://app.test/api/internal/line", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    expect(hooks.claimLineWebhookReceipts).not.toHaveBeenCalled();
  });
  it("returns only aggregate results to the authorized scheduler", async () => {
    vi.stubEnv("CRON_SECRET", "s".repeat(32)); vi.stubEnv("LINE_NOTIFICATIONS_ENABLED", "false");
    const response = await GET(new Request("https://app.test/api/internal/line", { headers: { authorization: `Bearer ${"s".repeat(32)}` } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ receiptsIgnored: 1, notifications: "disabled" });
    expect(hooks.claimOutbox).not.toHaveBeenCalled();
  });
  it("does not reflect a database/provider error into the response", async () => {
    vi.stubEnv("CRON_SECRET", "s".repeat(32));
    hooks.claimLineWebhookReceipts.mockRejectedValueOnce(new Error("private-provider-detail"));
    const response = await GET(new Request("https://app.test/api/internal/line", { headers: { authorization: `Bearer ${"s".repeat(32)}` } }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-provider-detail");
  });
});
