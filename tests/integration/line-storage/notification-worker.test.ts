import { describe, expect, it, vi } from "vitest";

import { deliverLineOutboxBatch, type LineOutboxOperations } from "../../../src/lib/line/notification-worker";

const event = {
  id: "80000000-0000-4000-8000-000000000001",
  event_type: "RENTAL_APPROVED",
  recipient_customer_id: "10000000-0000-4000-8000-000000000001",
  payload: { rentalId: "30000000-0000-4000-8000-000000000001" },
  attempts: 1,
  lease_token: "81000000-0000-4000-8000-000000000001",
};

function operations(rows: Array<typeof event & { recipient_line_user_id?: string }> = [event]) {
  const completeOutbox = vi.fn<LineOutboxOperations["completeOutbox"]>(async () => true);
  return { value: { claimOutbox: vi.fn(async () => rows), completeOutbox } satisfies LineOutboxOperations, completeOutbox };
}

const render = (type: string) => type === "RENTAL_APPROVED" ? [{ type: "text" as const, text: "รายการเช่าได้รับอนุมัติแล้ว" }] : null;

describe("LINE notification outbox delivery", () => {
  it("converges an already-accepted retry using the scoped recipient without a table resolver", async () => {
    const ops = operations([{ ...event, recipient_line_user_id: "U-synthetic-recipient" }]);
    const fetcher = vi.fn(async () => new Response(null, { status: 409, headers: { "x-line-accepted-request-id": "accepted-request" } }));
    expect((await deliverLineOutboxBatch({ operations: ops.value, channelAccessToken: "synthetic-access-token", fetcher, render })).delivered).toBe(1);
    expect(ops.completeOutbox).toHaveBeenCalledWith(event.id, event.lease_token, true, undefined, 30);
  });

  it("leaves a provider-accepted event recoverable when durable completion fails", async () => {
    const ops = operations();
    ops.completeOutbox.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(deliverLineOutboxBatch({ operations: ops.value, channelAccessToken: "synthetic-access-token", resolveRecipient: async () => "U-synthetic-recipient", fetcher: async () => new Response(null, { status: 200 }), render })).rejects.toThrow("database unavailable");
    expect(ops.completeOutbox).toHaveBeenCalledTimes(1);
    expect(ops.completeOutbox.mock.calls[0]?.[2]).toBe(true);
  });
  it("uses the durable outbox id as the provider retry key and completes the lease", async () => {
    const ops = operations();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer synthetic-access-token");
      expect(headers.get("x-line-retry-key")).toBe(event.id);
      expect(JSON.parse(String(init?.body))).toEqual({ to: "U-synthetic-recipient", messages: render(event.event_type) });
      return new Response(null, { status: 200 });
    });
    await expect(deliverLineOutboxBatch({
      operations: ops.value, channelAccessToken: "synthetic-access-token", fetcher,
      resolveRecipient: async () => "U-synthetic-recipient", render,
    })).resolves.toEqual({ claimed: 1, delivered: 1, failed: 0, malformed: 0 });
    expect(ops.completeOutbox).toHaveBeenCalledWith(event.id, event.lease_token, true, undefined, 30);
  });

  it("records retry-safe categories without reading or logging provider bodies", async () => {
    const ops = operations();
    const fetcher = vi.fn(async () => new Response("provider detail must stay private", { status: 429, headers: { "retry-after": "120" } }));
    await deliverLineOutboxBatch({
      operations: ops.value, channelAccessToken: "synthetic-access-token", fetcher,
      resolveRecipient: async () => "U-synthetic-recipient", render,
    });
    expect(ops.completeOutbox).toHaveBeenCalledWith(event.id, event.lease_token, false, "LINE_RATE_LIMITED", 120);
  });

  it("fails closed before the provider call when recipient or event approval is absent", async () => {
    const ops = operations();
    const fetcher = vi.fn();
    await deliverLineOutboxBatch({
      operations: ops.value, channelAccessToken: "synthetic-access-token", fetcher,
      resolveRecipient: async () => null, render,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(ops.completeOutbox).toHaveBeenCalledWith(event.id, event.lease_token, false, "RECIPIENT_UNAVAILABLE", 3_600);
  });
});
