import { createHmac, timingSafeEqual } from "node:crypto";
import { requestHash } from "../../domain/idempotency";

export const MAX_LINE_WEBHOOK_BYTES = 1_048_576;

export class LineWebhookError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
  }
}

export type LineWebhookEvent = Record<string, unknown> & { webhookEventId: string };

export function lineReceiptMetadata(event: LineWebhookEvent): { providerEventId: string; eventType: string; occurredAt?: string; payloadHash: string } {
  if (typeof event.type !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(event.type)) throw new LineWebhookError("INVALID_EVENT_TYPE", 400);
  const immutableEvent = { ...event };
  delete immutableEvent.deliveryContext;
  const timestamp = event.timestamp;
  if (timestamp !== undefined && (typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 8_640_000_000_000_000)) throw new LineWebhookError("INVALID_EVENT_TIME", 400);
  return { providerEventId: event.webhookEventId, eventType: event.type,
    ...(typeof timestamp === "number" ? { occurredAt: new Date(timestamp).toISOString() } : {}),
    payloadHash: requestHash(immutableEvent) };
}

export async function readBoundedWebhookBody(request: Request, limit = MAX_LINE_WEBHOOK_BYTES): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new LineWebhookError("BODY_TOO_LARGE", 413);
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new LineWebhookError("BODY_TOO_LARGE", 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export function verifyLineWebhookSignature(body: Uint8Array, signature: string | null, channelSecret: string): boolean {
  if (!signature || !channelSecret || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const expected = createHmac("sha256", channelSecret).update(body).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, "base64"); } catch { return false; }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function parseLineWebhook(body: Uint8Array): LineWebhookEvent[] {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
  catch { throw new LineWebhookError("INVALID_JSON", 400); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LineWebhookError("INVALID_BODY", 400);
  const events = (value as Record<string, unknown>).events;
  if (!Array.isArray(events) || events.length > 100) throw new LineWebhookError("INVALID_EVENTS", 400);
  return events.map((event) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new LineWebhookError("INVALID_EVENT", 400);
    const id = (event as Record<string, unknown>).webhookEventId;
    if (typeof id !== "string" || !id || id.length > 255) throw new LineWebhookError("INVALID_EVENT_ID", 400);
    return event as LineWebhookEvent;
  });
}

export async function handleLineWebhookRequest(
  request: Request,
  options: { channelSecret: string | undefined; persist?: (events: readonly LineWebhookEvent[]) => Promise<void> },
): Promise<Response> {
  try {
    if (!options.channelSecret) throw new LineWebhookError("WEBHOOK_UNAVAILABLE", 503);
    const body = await readBoundedWebhookBody(request);
    if (!verifyLineWebhookSignature(body, request.headers.get("x-line-signature"), options.channelSecret)) {
      throw new LineWebhookError("INVALID_SIGNATURE", 401);
    }
    const events = parseLineWebhook(body);
    if (!events.length) return Response.json({ accepted: true });
    if (!options.persist) throw new LineWebhookError("RECEIPT_UNAVAILABLE", 503);
    await options.persist(events);
    return Response.json({ accepted: true });
  } catch (error) {
    const failure = error instanceof LineWebhookError ? error : new LineWebhookError("RECEIPT_UNAVAILABLE", 503);
    return Response.json({ error: { code: failure.code } }, { status: failure.status });
  }
}
