import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

import type { AdminPrincipal, OperationResult, Principal } from "../../services/api-operations";
import { decodeJwtPayload, safeEqual, sha256 } from "./security";

export const ADMIN_OAUTH_COOKIE = "nr_admin_oauth";
export const ADMIN_MFA_COOKIE = "nr_admin_mfa_pending";
export const ADMIN_MFA_CSRF_COOKIE = "nr_admin_mfa_csrf";
const callbackPath = "/api/v1/admin/auth/callback";
const cookiePath = "/api/v1/admin/auth";

export type AdminOAuthConfig = {
  appUrl: string;
  supabaseUrl: string;
  publishableKey: string;
  provider: string;
  sessionSecret: string;
};
export type AdminOAuthDependencies = {
  fetch: typeof fetch;
  now: () => Date;
  token: (bytes?: number) => string;
};

function signature(value: string, secret: string): string {
  return createHmac("sha256", secret).update(`admin-oauth:${value}`).digest("base64url");
}
function callbackCookie(value: string, maxAge: number): string {
  return `${ADMIN_OAUTH_COOKIE}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=${cookiePath}; HttpOnly; Secure; SameSite=Lax`;
}
function pendingCookie(name: string, value: string, maxAge: number, httpOnly: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=${httpOnly ? `${cookiePath}/mfa` : "/"};${httpOnly ? " HttpOnly;" : ""} Secure; SameSite=Lax`;
}
type PendingMfa = { token: string; subject: string; factorId: string; csrf: string; expiresAt: number; challengeId?: string; challengeExpiresAt?: number };
function pendingKey(secret: string): Buffer { return createHash("sha256").update(`admin-pending-mfa:${secret}`).digest(); }
function encryptPending(value: PendingMfa, secret: string): string {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", pendingKey(secret), iv);
  cipher.setAAD(Buffer.from(ADMIN_MFA_COOKIE));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const cookie = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
  if (cookie.length > 3800) throw new Error("MFA_PENDING_TOO_LARGE");
  return cookie;
}
function decryptPending(value: unknown, config: AdminOAuthConfig, now: number): PendingMfa {
  if (typeof value !== "string" || value.length > 3800 || value.length < 40) throw new Error("INVALID_PENDING_MFA");
  const bytes = Buffer.from(value, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", pendingKey(config.sessionSecret), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(ADMIN_MFA_COOKIE)); decipher.setAuthTag(bytes.subarray(12, 28));
  const pending = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) as PendingMfa;
  if (typeof pending.token !== "string" || typeof pending.subject !== "string" || typeof pending.factorId !== "string"
    || typeof pending.csrf !== "string" || !Number.isSafeInteger(pending.expiresAt) || pending.expiresAt <= now || pending.expiresAt > now + 300_000) throw new Error("INVALID_PENDING_MFA");
  return pending;
}
function clearPending(headers: Headers): void {
  headers.append("Set-Cookie", pendingCookie(ADMIN_MFA_COOKIE, "", 0, true));
  headers.append("Set-Cookie", pendingCookie(ADMIN_MFA_CSRF_COOKIE, "", 0, false));
}
function setPending(headers: Headers, pending: PendingMfa, config: AdminOAuthConfig, now: number): void {
  const maxAge = Math.max(1, Math.floor((pending.expiresAt - now) / 1000));
  headers.append("Set-Cookie", pendingCookie(ADMIN_MFA_COOKIE, encryptPending(pending, config.sessionSecret), maxAge, true));
  headers.append("Set-Cookie", pendingCookie(ADMIN_MFA_CSRF_COOKIE, pending.csrf, maxAge, false));
}
function configuredUrls(config: AdminOAuthConfig): { app: URL; auth: URL } {
  const app = new URL(config.appUrl);
  const auth = new URL(config.supabaseUrl);
  if (![app, auth].every((url) => url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash)
    || app.pathname !== "/" || auth.pathname !== "/" || !/^[a-z][a-z0-9_-]{0,63}$/.test(config.provider)
    || config.sessionSecret.length < 32 || !config.publishableKey) throw new Error("ADMIN_AUTH_UNAVAILABLE");
  return { app, auth };
}

export function startAdminOAuth(config: AdminOAuthConfig, dependencies: AdminOAuthDependencies): OperationResult {
  const { app, auth } = configuredUrls(config);
  const state = dependencies.token(32);
  const verifier = dependencies.token(48);
  const value = Buffer.from(JSON.stringify({ state, verifier, expiresAt: dependencies.now().getTime() + 300_000 })).toString("base64url");
  const callback = new URL(callbackPath, app);
  callback.searchParams.set("state", state);
  const location = new URL("/auth/v1/authorize", auth);
  location.searchParams.set("provider", config.provider);
  location.searchParams.set("redirect_to", callback.toString());
  location.searchParams.set("code_challenge", Buffer.from(sha256(verifier), "hex").toString("base64url"));
  location.searchParams.set("code_challenge_method", "s256");
  return { status: 303, headers: { Location: location.toString(), "Set-Cookie": callbackCookie(`${value}.${signature(value, config.sessionSecret)}`, 300), "Referrer-Policy": "no-referrer" } };
}

export async function completeAdminOAuth(
  input: { code?: unknown; state?: unknown; oauthCookie?: unknown; invalidQuery?: unknown },
  config: AdminOAuthConfig,
  dependencies: AdminOAuthDependencies,
  resolveAdmin: (token: string) => Promise<Principal | null>,
): Promise<OperationResult> {
  const headers = new Headers({ Location: "/admin/login?reason=authentication-failed", "Referrer-Policy": "no-referrer" });
  headers.append("Set-Cookie", callbackCookie("", 0));
  try {
    const { auth } = configuredUrls(config);
    if (input.invalidQuery || typeof input.code !== "string" || input.code.length < 16 || input.code.length > 2048
      || typeof input.state !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(input.state)
      || typeof input.oauthCookie !== "string" || input.oauthCookie.length > 2048) return { status: 303, headers };
    const parts = input.oauthCookie.split(".");
    if (parts.length !== 2 || !safeEqual(parts[1]!, signature(parts[0]!, config.sessionSecret))) return { status: 303, headers };
    const binding = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")) as Record<string, unknown>;
    const now = dependencies.now().getTime();
    if (typeof binding.state !== "string" || !safeEqual(binding.state, input.state)
      || typeof binding.verifier !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(binding.verifier)
      || typeof binding.expiresAt !== "number" || binding.expiresAt <= now || binding.expiresAt > now + 300_000) return { status: 303, headers };
    // The provider consumes each auth code atomically; clearing the binding also prevents normal browser callback replay.
    const exchanged = await dependencies.fetch(new URL("/auth/v1/token?grant_type=pkce", auth), {
      method: "POST", headers: { apikey: config.publishableKey, "content-type": "application/json" },
      body: JSON.stringify({ auth_code: input.code, code_verifier: binding.verifier }), signal: AbortSignal.timeout(10_000),
    });
    if (!exchanged.ok) return { status: 303, headers };
    const session = await exchanged.json() as Record<string, unknown>;
    const token = session.access_token;
    if (typeof token !== "string" || token.length > 3500) return { status: 303, headers };
    const { claims, user } = await verifyProviderToken(token, config, dependencies);
    const seconds = Math.floor(now / 1000);
    if (claims.aal === "aal1") {
      const factors = Array.isArray(user.factors) ? user.factors as Record<string, unknown>[] : [];
      const factor = factors.find((item) => item.factor_type === "totp" && item.status === "verified" && typeof item.id === "string" && /^[0-9a-f-]{36}$/i.test(item.id));
      if (!factor) return { status: 303, headers };
      setPending(headers, { token, subject: claims.sub, factorId: factor.id as string, csrf: dependencies.token(32), expiresAt: Math.min(now + 300_000, claims.exp * 1000) }, config, now);
      headers.set("Location", "/admin/login?step=mfa");
      return { status: 303, headers };
    }
    const principal = await resolveAdmin(token);
    if (!principal || principal.kind !== "admin" || !principal.mfaVerified || !principal.roles.length || !principal.csrfToken) return { status: 303, headers };
    setAdminCookies(headers, principal, token, Math.min(28_800, claims.exp - seconds));
    clearPending(headers);
    headers.set("Location", "/admin");
  } catch { /* All callback failures use the same recovery URL and clear the one-use browser binding. */ }
  return { status: 303, headers };
}

async function verifyProviderToken(token: string, config: AdminOAuthConfig, dependencies: AdminOAuthDependencies): Promise<{ claims: Record<string, unknown> & { sub: string; exp: number }; user: Record<string, unknown> }> {
  const { auth } = configuredUrls(config); const claims = decodeJwtPayload(token); const seconds = Math.floor(dependencies.now().getTime() / 1000); const audience = claims?.aud;
  if (token.length > 3500 || claims?.iss !== new URL("/auth/v1", auth).toString() || !(audience === "authenticated" || Array.isArray(audience) && audience.includes("authenticated"))
    || claims.role !== "authenticated" || !["aal1", "aal2"].includes(String(claims.aal)) || typeof claims.sub !== "string"
    || typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp) || claims.exp <= seconds
    || typeof claims.iat !== "number" || claims.iat > seconds + 30 || (typeof claims.nbf === "number" && claims.nbf > seconds + 30)) throw new Error("INVALID_PROVIDER_SESSION");
  const verified = await dependencies.fetch(new URL("/auth/v1/user", auth), { headers: { apikey: config.publishableKey, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  if (!verified.ok) throw new Error("INVALID_PROVIDER_SESSION");
  const user = await verified.json() as Record<string, unknown>;
  if (user.id !== claims.sub) throw new Error("INVALID_PROVIDER_SESSION");
  return { claims: claims as Record<string, unknown> & { sub: string; exp: number }, user };
}

export async function handleAdminMfa(
  action: "challenge" | "verify",
  input: { pendingCookie?: unknown; csrfCookie?: unknown; csrfHeader?: unknown; challengeId?: unknown; code?: unknown },
  config: AdminOAuthConfig, dependencies: AdminOAuthDependencies, resolveAdmin: (token: string) => Promise<Principal | null>,
): Promise<OperationResult> {
  const headers = new Headers();
  try {
    configuredUrls(config);
    const now = dependencies.now().getTime(); const pending = decryptPending(input.pendingCookie, config, now);
    if (typeof input.csrfHeader !== "string" || typeof input.csrfCookie !== "string" || !safeEqual(input.csrfHeader, input.csrfCookie) || !safeEqual(input.csrfHeader, pending.csrf)) {
      return { status: 403, body: { error: { code: "FORBIDDEN", message: "MFA request is not permitted" } } };
    }
    const { claims, user } = await verifyProviderToken(pending.token, config, dependencies);
    if (claims.sub !== pending.subject || claims.aal !== "aal1") throw new Error("INVALID_PENDING_MFA");
    const factors = Array.isArray(user.factors) ? user.factors as Record<string, unknown>[] : [];
    if (!factors.some((factor) => factor.id === pending.factorId && factor.factor_type === "totp" && factor.status === "verified")) throw new Error("INVALID_PENDING_MFA");
    const url = new URL(`/auth/v1/factors/${encodeURIComponent(pending.factorId)}/${action}`, config.supabaseUrl);
    const body = action === "challenge" ? {} : { challenge_id: input.challengeId, code: input.code };
    if (action === "verify" && (typeof input.code !== "string" || !/^[0-9]{6}$/.test(input.code) || !pending.challengeId
      || input.challengeId !== pending.challengeId || !pending.challengeExpiresAt || pending.challengeExpiresAt <= now)) throw new Error("INVALID_MFA_CHALLENGE");
    const response = await dependencies.fetch(url, { method: "POST", headers: { apikey: config.publishableKey, authorization: `Bearer ${pending.token}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("MFA_VERIFICATION_FAILED");
    const result = await response.json() as Record<string, unknown>;
    if (action === "challenge") {
      if (typeof result.id !== "string" || !/^[0-9a-f-]{36}$/i.test(result.id) || typeof result.expires_at !== "number" || !Number.isSafeInteger(result.expires_at)) throw new Error("INVALID_MFA_CHALLENGE");
      const expiresAt = Math.min(pending.expiresAt, result.expires_at * 1000);
      if (expiresAt <= now) throw new Error("INVALID_MFA_CHALLENGE");
      setPending(headers, { ...pending, challengeId: result.id, challengeExpiresAt: expiresAt }, config, now);
      return { status: 200, headers, body: { challengeId: result.id, expiresAt: new Date(expiresAt).toISOString() } };
    }
    if (typeof result.access_token !== "string") throw new Error("INVALID_MFA_SESSION");
    const upgraded = await verifyProviderToken(result.access_token, config, dependencies);
    if (upgraded.claims.aal !== "aal2" || upgraded.claims.sub !== pending.subject) throw new Error("INVALID_MFA_SESSION");
    const principal = await resolveAdmin(result.access_token);
    if (!principal || principal.kind !== "admin" || !principal.mfaVerified || !principal.roles.length || !principal.csrfToken) throw new Error("ADMIN_REQUIRED");
    clearPending(headers);
    setAdminCookies(headers, principal, result.access_token, Math.min(28_800, upgraded.claims.exp - Math.floor(now / 1000)));
    return { status: 204, headers };
  } catch {
    clearPending(headers);
    return { status: 401, headers, body: { error: { code: "AUTH_REQUIRED", message: "MFA session is invalid or expired" } } };
  }
}

function setAdminCookies(headers: Headers, principal: AdminPrincipal, token: string, maxAge: number): void {
  headers.append("Set-Cookie", `nr_admin_session=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`);
  headers.append("Set-Cookie", `nr_admin_csrf=${encodeURIComponent(principal.csrfToken!)}; Max-Age=${maxAge}; Path=/; Secure; SameSite=Lax`);
}
