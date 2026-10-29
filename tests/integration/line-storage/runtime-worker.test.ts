import { describe, expect, it, vi } from "vitest";
import { runLineWorker, type LineWorkerOperations } from "../../../src/lib/line/runtime-worker";

function operations(): LineWorkerOperations {
  return {
    claimLineWebhookReceipts: vi.fn(async () => [{ id: "receipt-1", lease_token: "fence-1" }]),
    completeLineWebhookReceipt: vi.fn(async () => true),
    claimOutbox: vi.fn(async () => [{ id: "80000000-0000-4000-8000-000000000001", lease_token: "fence-2", event_type: "PAYMENT_SUBMITTED", attempts: 1, recipient_line_user_id: `U${"a".repeat(32)}`, payload: { rentalId: "30000000-0000-4000-8000-000000000001" } }]),
    completeOutbox: vi.fn(async () => true),
  };
}

describe("scheduled LINE runtime boundary", () => {
  it("durably ignores unsupported inbound chat and does not claim outbound work without approved configuration", async () => {
    const current = operations(); const fetcher = vi.fn();
    expect(await runLineWorker({ operations: current, notificationsEnabled: true, policyJson: "{}", channelAccessToken: "synthetic-token", fetcher })).toEqual({ receiptsIgnored: 1, notifications: "disabled" });
    expect(current.completeLineWebhookReceipt).toHaveBeenCalledWith("receipt-1", "fence-1", "IGNORED", "NO_SUBSCRIBED_HANDLER");
    expect(current.claimOutbox).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });

  it("notifies the approved admin about a submitted payment without exposing customer profile data", async () => {
    const current = operations(); const admin = `U${"b".repeat(32)}`;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ to: admin, messages: [{ type: "text", text: "ตรวจรายการ 30000000-0000-4000-8000-000000000001" }] });
      return new Response(null, { status: 200 });
    });
    const result = await runLineWorker({ operations: current, notificationsEnabled: true, policyJson: JSON.stringify({ approvalReference: "synthetic-approval", adminRecipientId: admin, events: { PAYMENT_SUBMITTED: { recipient: "ADMIN", text: "ตรวจรายการ {rentalId}" } } }), channelAccessToken: "synthetic-token", fetcher });
    expect(result.notifications).toMatchObject({ claimed: 1, delivered: 1, failed: 0 });
  });

  it("does not send an event absent from the approved template allowlist", async () => {
    const current = operations(); const fetcher = vi.fn();
    await runLineWorker({ operations: current, notificationsEnabled: true, policyJson: JSON.stringify({ approvalReference: "synthetic-approval", events: { RENTAL_APPROVED: { recipient: "CUSTOMER", text: "อนุมัติแล้ว" } } }), channelAccessToken: "synthetic-token", fetcher });
    expect(fetcher).not.toHaveBeenCalled();
    expect(current.completeOutbox).toHaveBeenCalledWith("80000000-0000-4000-8000-000000000001", "fence-2", false, "EVENT_NOT_APPROVED", 3600);
  });
});
