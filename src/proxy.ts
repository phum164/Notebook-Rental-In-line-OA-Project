import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const nonce = randomBytes(24).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  let storageOrigin = "";
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    if (url.protocol === "https:" && !url.username && !url.password) storageOrigin = url.origin;
  } catch { /* Missing/invalid provider configuration grants no additional origin. */ }
  const isAdmin = request.nextUrl.pathname === "/admin" || request.nextUrl.pathname.startsWith("/admin/");
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://static.line-scdn.net https://liff.line.me${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${storageOrigin} https://api.line.me https://liff.line.me https://access.line.me${isDev ? " ws: wss:" : ""}`,
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "frame-src 'self' https://liff.line.me https://access.line.me",
    `frame-ancestors ${isAdmin ? "'none'" : "'self' https://liff.line.me"}`,
    "object-src 'none'", "base-uri 'self'", "form-action 'self'",
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [{
    source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
    missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }],
  }],
};
