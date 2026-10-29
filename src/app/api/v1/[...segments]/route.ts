import { handleRuntimeApiRequest } from "@/lib/server/api-router";

export const runtime = "nodejs";

export const GET = handleRuntimeApiRequest;
export const POST = handleRuntimeApiRequest;
export const PATCH = handleRuntimeApiRequest;
export const DELETE = handleRuntimeApiRequest;
