import { handleLineWebhookRequest, lineReceiptMetadata } from "@/lib/line/webhook";
import { runtimeSupabaseOperations } from "@/services/supabase-api-operations";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return handleLineWebhookRequest(request, {
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    persist: async (events) => { await runtimeSupabaseOperations().persistLineWebhookReceipts(events.map(lineReceiptMetadata)); },
  });
}
