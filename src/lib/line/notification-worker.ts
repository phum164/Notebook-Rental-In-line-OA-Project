type JsonObject = Record<string, unknown>;

export type LineOutboxItem = {
  id: string;
  leaseToken: string;
  eventType: string;
  attempts: number;
  payload: JsonObject;
  recipientCustomerId: string;
  recipientLineUserId: string | null;
};

export type LineOutboxOperations = {
  claimOutbox(limit?: number): Promise<unknown[]>;
  completeOutbox(eventId: string, leaseToken: string, delivered: boolean, errorCategory?: string, retryAfterSeconds?: number): Promise<boolean>;
};

export type LineMessage = { type: "text"; text: string };

function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function item(value: unknown): LineOutboxItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as JsonObject;
  const payload = row.payload;
  const parsed = {
    id: text(row.id),
    leaseToken: text(row.leaseToken ?? row.lease_token),
    eventType: text(row.eventType ?? row.event_type),
    attempts: Number(row.attempts),
    payload: payload && typeof payload === "object" && !Array.isArray(payload) ? payload as JsonObject : {},
    recipientCustomerId: text(row.recipientCustomerId ?? row.recipient_customer_id),
    recipientLineUserId: text(row.recipientLineUserId ?? row.recipient_line_user_id) || null,
  };
  return parsed.id && parsed.leaseToken && parsed.eventType && Number.isInteger(parsed.attempts) && parsed.attempts > 0 ? parsed : null;
}

function retrySeconds(response: Response, attempts: number): number {
  const provider = Number(response.headers.get("retry-after"));
  if (Number.isInteger(provider) && provider >= 1 && provider <= 86_400) return provider;
  return Math.min(3_600, 30 * (2 ** Math.min(6, Math.max(0, attempts - 1))));
}

function category(status: number): string {
  if (status === 429) return "LINE_RATE_LIMITED";
  if (status === 401 || status === 403) return "LINE_AUTH_REJECTED";
  if (status >= 500) return "LINE_PROVIDER_UNAVAILABLE";
  return "LINE_MESSAGE_REJECTED";
}

export async function deliverLineOutboxBatch(options: {
  operations: LineOutboxOperations;
  channelAccessToken?: string;
  resolveRecipient?: (customerId: string) => Promise<string | null>;
  render: (eventType: string, payload: Readonly<JsonObject>) => readonly LineMessage[] | null;
  fetcher?: typeof fetch;
  limit?: number;
}): Promise<{ claimed: number; delivered: number; failed: number; malformed: number }> {
  if (!options.channelAccessToken) throw new Error("LINE_NOTIFICATION_UNAVAILABLE");
  const fetcher = options.fetcher ?? fetch;
  const claimed = await options.operations.claimOutbox(options.limit ?? 20);
  let delivered = 0; let failed = 0; let malformed = 0;

  for (const raw of claimed) {
    const event = item(raw);
    if (!event) { malformed += 1; continue; }
    const recipient = event.recipientLineUserId ?? await options.resolveRecipient?.(event.recipientCustomerId) ?? null;
    const messages = options.render(event.eventType, event.payload);
    if (!recipient || !messages?.length) {
      await options.operations.completeOutbox(event.id, event.leaseToken, false, recipient ? "EVENT_NOT_APPROVED" : "RECIPIENT_UNAVAILABLE", 3_600);
      failed += 1;
      continue;
    }
    let response: Response;
    try {
      response = await fetcher("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.channelAccessToken}`,
          "content-type": "application/json",
          "x-line-retry-key": event.id,
        },
        body: JSON.stringify({ to: recipient, messages }),
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      });
    } catch {
      await options.operations.completeOutbox(event.id, event.leaseToken, false, "LINE_NETWORK_ERROR", retrySeconds(new Response(null, { status: 503 }), event.attempts));
      failed += 1;
      continue;
    }
    // LINE returns 409 plus this header when the same retry key was already accepted.
    const ok = response.ok || (response.status === 409 && Boolean(response.headers.get("x-line-accepted-request-id")));
    const completed = await options.operations.completeOutbox(event.id, event.leaseToken, ok, ok ? undefined : category(response.status), retrySeconds(response, event.attempts));
    if (ok && completed) delivered += 1; else failed += 1;
  }
  return { claimed: claimed.length, delivered, failed, malformed };
}
