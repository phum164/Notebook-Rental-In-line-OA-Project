import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { handleLineWebhookRequest, lineReceiptMetadata, verifyLineWebhookSignature } from "../../src/lib/line/webhook";

const secret = "synthetic-channel-secret";
const signedRequest = (body: string, signature = createHmac("sha256", secret).update(body).digest("base64")) => new Request("https://app.test/api/webhooks/line", {
  method: "POST",
  headers: { "content-type": "application/json", "x-line-signature": signature },
  body,
});

describe("LINE webhook trust boundary", () => {
  it("persists only metadata and hashes redeliveries consistently", () => {
    const event = { webhookEventId: "event-1", type: "message", timestamp: 1_700_000_000_000, source: { userId: "synthetic-user" }, message: { text: "synthetic-private-text" } };
    const first = lineReceiptMetadata({ ...event, deliveryContext: { isRedelivery: false } });
    expect(first).toEqual(lineReceiptMetadata({ ...event, deliveryContext: { isRedelivery: true } }));
    expect(Object.keys(first).sort()).toEqual(["eventType", "occurredAt", "payloadHash", "providerEventId"]);
    expect(JSON.stringify(first)).not.toMatch(/synthetic-user|synthetic-private-text/);
    expect(() => lineReceiptMetadata({ webhookEventId: "event-1", type: "message", timestamp: "invalid" })).toThrow("INVALID_EVENT_TIME");
  });
  it("verifies the exact raw body before parsing", async () => {
    const body = "{ not-json }";
    expect(verifyLineWebhookSignature(new TextEncoder().encode(body), "wrong", secret)).toBe(false);
    const rejected = await handleLineWebhookRequest(signedRequest(body, "wrong"), { channelSecret: secret });
    expect(rejected.status).toBe(401);
    const verifiedButMalformed = await handleLineWebhookRequest(signedRequest(body), { channelSecret: secret });
    expect(verifiedButMalformed.status).toBe(400);
  });

  it("accepts provider verification but fails closed without durable receipts", async () => {
    const verification = JSON.stringify({ events: [] });
    expect((await handleLineWebhookRequest(signedRequest(verification), { channelSecret: secret })).status).toBe(200);

    const delivery = JSON.stringify({ events: [{ webhookEventId: "event-1", type: "message" }] });
    const unavailable = await handleLineWebhookRequest(signedRequest(delivery), { channelSecret: secret });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: { code: "RECEIPT_UNAVAILABLE" } });
  });

  it("passes only verified, bounded events to the durable receipt hook", async () => {
    const persist = vi.fn(async () => undefined);
    const body = JSON.stringify({ events: [{ webhookEventId: "event-2", type: "follow" }] });
    expect((await handleLineWebhookRequest(signedRequest(body), { channelSecret: secret, persist })).status).toBe(200);
    expect(persist).toHaveBeenCalledWith([expect.objectContaining({ webhookEventId: "event-2" })]);

    const oversized = new Request("https://app.test/api/webhooks/line", {
      method: "POST", headers: { "content-length": "1048577", "x-line-signature": "invalid" }, body: "x",
    });
    expect((await handleLineWebhookRequest(oversized, { channelSecret: secret, persist })).status).toBe(413);
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
