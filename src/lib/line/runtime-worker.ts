import { z } from "zod";
import { RENTAL_STATUSES } from "../../types/domain";
import { deliverLineOutboxBatch, type LineOutboxOperations } from "./notification-worker";

export type LineWorkerOperations = LineOutboxOperations & {
  claimLineWebhookReceipts(limit?: number): Promise<unknown[]>;
  completeLineWebhookReceipt(id: string, leaseToken: string, outcome: "PROCESSED" | "IGNORED" | "FAILED", errorCategory?: string): Promise<boolean>;
};

const eventTypes = new Set(["PAYMENT_SUBMITTED", ...RENTAL_STATUSES.map((status) => `RENTAL_${status}`)]);
const policySchema = z.object({
  approvalReference: z.string().trim().min(1).max(200),
  adminRecipientId: z.string().regex(/^U[0-9a-f]{32}$/i).optional(),
  events: z.record(z.string().refine((event) => eventTypes.has(event)), z.object({
    recipient: z.enum(["CUSTOMER", "ADMIN"]),
    text: z.string().trim().min(1).max(4000),
  }).strict()),
}).strict().superRefine((policy, context) => {
  if (!Object.keys(policy.events).length || (Object.values(policy.events).some((event) => event.recipient === "ADMIN") && !policy.adminRecipientId)) {
    context.addIssue({ code: "custom", message: "Approved event and recipient configuration is required" });
  }
});

function approvedPolicy(value: string | undefined): z.infer<typeof policySchema> | null {
  if (!value || value.length > 65_536) return null;
  try { const result = policySchema.safeParse(JSON.parse(value)); return result.success ? result.data : null; }
  catch { return null; }
}

function receipt(value: unknown): { id: string; leaseToken: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.lease_token === "string" ? { id: row.id, leaseToken: row.lease_token } : null;
}

export async function runLineWorker(options: {
  operations: LineWorkerOperations;
  notificationsEnabled?: boolean;
  policyJson?: string | undefined;
  channelAccessToken?: string | undefined;
  fetcher?: typeof fetch;
}): Promise<{ receiptsIgnored: number; notifications: "disabled" | { claimed: number; delivered: number; failed: number; malformed: number } }> {
  let receiptsIgnored = 0;
  const claimed = await options.operations.claimLineWebhookReceipts(3);
  for (const raw of claimed) {
    const current = receipt(raw);
    if (!current) throw new Error("INVALID_RECEIPT_PROJECTION");
    // The SRD defines outbound rental notifications; inbound chat actions have no business handler.
    if (await options.operations.completeLineWebhookReceipt(current.id, current.leaseToken, "IGNORED", "NO_SUBSCRIBED_HANDLER")) receiptsIgnored += 1;
  }

  const policy = options.notificationsEnabled ? approvedPolicy(options.policyJson) : null;
  if (!policy || !options.channelAccessToken) return { receiptsIgnored, notifications: "disabled" };

  const notifications = await deliverLineOutboxBatch({
    operations: {
      claimOutbox: async () => (await options.operations.claimOutbox(3)).map((raw) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
        const row = raw as Record<string, unknown>;
        const eventType = row.eventType ?? row.event_type;
        const template = typeof eventType === "string" ? policy.events[eventType] : undefined;
        return { ...row, recipientLineUserId: template?.recipient === "ADMIN" ? policy.adminRecipientId : row.recipientLineUserId ?? row.recipient_line_user_id };
      }),
      completeOutbox: (...args) => options.operations.completeOutbox(...args),
    },
    channelAccessToken: options.channelAccessToken,
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    render: (eventType, payload) => {
      const template = policy.events[eventType];
      if (!template) return null;
      const rentalId = typeof payload.rentalId === "string" && /^[0-9a-f-]{36}$/i.test(payload.rentalId) ? payload.rentalId : null;
      if (template.text.includes("{rentalId}") && !rentalId) return null;
      return [{ type: "text", text: template.text.replaceAll("{rentalId}", rentalId ?? "") }];
    },
  });
  return { receiptsIgnored, notifications };
}
