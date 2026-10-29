import { safeEqual } from "../../../../lib/server/security";
import { runLineWorker } from "../../../../lib/line/runtime-worker";
import { runtimeSupabaseOperations } from "../../../../services/supabase-api-operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const headers = { "Cache-Control": "private, no-store" };
  if (!secret || secret.length < 32) return Response.json({ error: { code: "WORKER_UNAVAILABLE" } }, { status: 503, headers });
  if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401, headers });
  try {
    const result = await runLineWorker({
      operations: runtimeSupabaseOperations(),
      notificationsEnabled: process.env.LINE_NOTIFICATIONS_ENABLED === "true",
      policyJson: process.env.LINE_NOTIFICATION_POLICY_JSON,
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    });
    return Response.json(result, { headers });
  } catch {
    return Response.json({ error: { code: "WORKER_UNAVAILABLE" } }, { status: 503, headers });
  }
}
