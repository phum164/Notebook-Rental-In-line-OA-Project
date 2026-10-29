import { afterEach, describe, expect, it, vi } from "vitest";

import { completeAdminOAuth, handleAdminMfa, startAdminOAuth, type AdminOAuthConfig, type AdminOAuthDependencies } from "../../src/lib/server/admin-oauth";
import { runtimeSupabaseOperations } from "../../src/services/supabase-api-operations";
import type { AdminPrincipal } from "../../src/services/api-operations";

const now = new Date("2026-10-26T10:00:00Z");
const seconds = now.getTime() / 1000;
const config: AdminOAuthConfig = {
  appUrl: "https://rental.example", supabaseUrl: "https://project.supabase.co", provider: "google",
  publishableKey: "synthetic-publishable", sessionSecret: "synthetic-session-secret-at-least-thirty-two-bytes",
};
const admin: AdminPrincipal = { kind: "admin", id: "admin-id", roles: ["OWNER"], mfaVerified: true, csrfToken: "bound-csrf" };
const json = (value: unknown, status = 200) => Response.json(value, { status });
function token(overrides: Record<string, unknown> = {}): string {
  return `header.${Buffer.from(JSON.stringify({ iss: "https://project.supabase.co/auth/v1", aud: "authenticated", role: "authenticated", aal: "aal2", sub: "provider-user", iat: seconds, exp: seconds + 3600, ...overrides })).toString("base64url")}.signature`;
}
function fixture(claims: Record<string, unknown> = {}, fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).includes("/token?") ? json({ access_token: token(claims) }) : json({ id: "provider-user" }))) {
  const dependencies: AdminOAuthDependencies = { fetch: fetcher, now: () => now, token: (bytes) => "A".repeat(bytes === 48 ? 64 : 43) };
  const start = startAdminOAuth(config, dependencies);
  const location = new URL(new Headers(start.headers).get("location")!);
  const callback = new URL(location.searchParams.get("redirect_to")!);
  const oauthCookie = decodeURIComponent(new Headers(start.headers).get("set-cookie")!.split(";", 1)[0]!.split("=")[1]!);
  return { dependencies, fetcher, location, input: { code: "synthetic-once-only-code", state: callback.searchParams.get("state")!, oauthCookie } };
}
function responseCookie(result: { headers?: HeadersInit }, name: string): string {
  const cookie = new Headers(result.headers).getSetCookie().find((value) => value.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.split(";", 1)[0]!.slice(name.length + 1)) : "";
}
async function pendingFixture(options: { wrongCode?: boolean; changedSubject?: boolean; unmapped?: boolean } = {}) {
  const factorId = "10000000-0000-4000-8000-000000000001";
  const challengeId = "20000000-0000-4000-8000-000000000001";
  let verified = false;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/token")) return json({ access_token: token({ aal: "aal1" }) });
    if (path.endsWith("/user")) return json({ id: "provider-user", factors: [{ id: factorId, factor_type: "totp", status: "verified" }, { id: "not-totp", factor_type: "phone", status: "verified" }] });
    if (path.endsWith("/challenge")) return json({ id: challengeId, expires_at: seconds + 120 });
    if (path.endsWith("/verify")) {
      if (options.wrongCode || verified) return json({ message: "private-provider-error" }, 400);
      verified = true;
      return json({ access_token: token(options.changedSubject ? { sub: "other-user" } : {}) });
    }
    return json({}, 500);
  });
  const setup = fixture({}, fetcher);
  const resolve = vi.fn(async () => options.unmapped ? null : admin);
  const callback = await completeAdminOAuth(setup.input, config, setup.dependencies, resolve);
  const pendingInput = { pendingCookie: responseCookie(callback, "nr_admin_mfa_pending"), csrfCookie: responseCookie(callback, "nr_admin_mfa_csrf"), csrfHeader: responseCookie(callback, "nr_admin_mfa_csrf") };
  const challenged = await handleAdminMfa("challenge", pendingInput, config, setup.dependencies, resolve);
  return { ...setup, resolve, callback, challenged, pendingInput: { ...pendingInput, pendingCookie: responseCookie(challenged, "nr_admin_mfa_pending"), challengeId, code: "123456" } };
}

afterEach(() => vi.unstubAllEnvs());

describe("admin OAuth PKCE boundary", () => {
  it("binds a fixed callback and S256 challenge without accepting a client redirect or role", async () => {
    const { dependencies, fetcher, location, input } = fixture();
    expect(location.origin).toBe("https://project.supabase.co");
    expect(location.pathname).toBe("/auth/v1/authorize");
    expect(location.searchParams.get("code_challenge_method")).toBe("s256");
    const resolve = vi.fn(async () => admin);
    const result = await completeAdminOAuth(input, config, dependencies, resolve);
    const headers = new Headers(result.headers);
    expect(headers.get("location")).toBe("/admin");
    expect(headers.get("set-cookie")).toContain("nr_admin_oauth=; Max-Age=0");
    expect(headers.get("set-cookie")).toContain("nr_admin_session=");
    expect(headers.get("set-cookie")).toContain("HttpOnly; Secure; SameSite=Lax");
    expect(resolve).toHaveBeenCalledWith(token());
    const exchange = fetcher.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(JSON.parse(String(exchange[1].body))).toEqual({ auth_code: input.code, code_verifier: "A".repeat(64) });
  });

  it.each(["mismatch", "tampered", "expired", "missing", "query-injection"])("rejects %s state before provider access and clears the callback cookie", async (mode) => {
    const { dependencies, fetcher, input } = fixture();
    if (mode === "mismatch") input.state = "B".repeat(43);
    if (mode === "tampered") input.oauthCookie += "x";
    const actualInput = mode === "missing" ? { code: input.code, state: input.state } : { ...input, ...(mode === "query-injection" ? { invalidQuery: true } : {}) };
    if (mode === "expired") dependencies.now = () => new Date(now.getTime() + 301_000);
    const result = await completeAdminOAuth(actualInput, config, dependencies, async () => admin);
    expect(new Headers(result.headers).get("location")).toBe("/admin/login?reason=authentication-failed");
    expect(new Headers(result.headers).get("set-cookie") ?? "").not.toContain("nr_admin_session=");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([{ aal: "aal1" }, { iss: "https://evil.test" }, { aud: "other-project" }, { exp: seconds }, { role: "service_role" }])("rejects invalid provider claims %j", async (claims) => {
    const { dependencies, input } = fixture(claims);
    const resolve = vi.fn(async () => admin);
    const result = await completeAdminOAuth(input, config, dependencies, resolve);
    expect(new Headers(result.headers).get("set-cookie")).not.toContain("nr_admin_session=");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("requires provider verification and an enabled server admin projection", async () => {
    const first = fixture({}, vi.fn(async (input: RequestInfo | URL) => String(input).includes("/token?") ? json({ access_token: token() }) : json({}, 401)));
    const resolve = vi.fn(async () => admin);
    expect(new Headers((await completeAdminOAuth(first.input, config, first.dependencies, resolve)).headers).get("location")).toContain("authentication-failed");
    expect(resolve).not.toHaveBeenCalled();
    const second = fixture();
    expect(new Headers((await completeAdminOAuth(second.input, config, second.dependencies, async () => null)).headers).get("set-cookie")).not.toContain("nr_admin_session=");
  });

  it("rejects reused provider codes and never reflects provider error details", async () => {
    let exchanges = 0;
    const { dependencies, input } = fixture({}, vi.fn(async (url: RequestInfo | URL) => {
      if (!String(url).includes("/token?")) return json({ id: "provider-user" });
      return ++exchanges === 1 ? json({ access_token: token() }) : json({ error_description: "sensitive-provider-detail" }, 400);
    }));
    expect(new Headers((await completeAdminOAuth(input, config, dependencies, async () => admin)).headers).get("location")).toBe("/admin");
    const replay = await completeAdminOAuth(input, config, dependencies, async () => admin);
    expect(new Headers(replay.headers).get("set-cookie")).not.toContain("nr_admin_session=");
    expect(JSON.stringify(replay)).not.toContain("sensitive-provider-detail");
  });

  it("accepts publishable aliases while refusing any secret-key fallback", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", config.appUrl); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", config.supabaseUrl);
    vi.stubEnv("SUPABASE_AUTH_PROVIDER", config.provider); vi.stubEnv("SESSION_SIGNING_SECRET", config.sessionSecret);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", undefined); vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined); vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", undefined);
    vi.stubEnv("SUPABASE_SECRET_KEY", "secret-must-never-be-used"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-must-never-be-used");
    expect((await runtimeSupabaseOperations().execute("startAdminLogin", {}, { requestId: "test", principal: null })).status).toBe(503);
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "public-server-alias");
    expect((await runtimeSupabaseOperations().execute("startAdminLogin", {}, { requestId: "test", principal: null })).status).toBe(303);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-browser-alias");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect((await runtimeSupabaseOperations().execute("startAdminLogin", {}, { requestId: "test", principal: null })).status).toBe(303);
  });

  it("completes aal1 OAuth only after a bound verified TOTP challenge and server admin projection", async () => {
    const setup = await pendingFixture();
    expect(new Headers(setup.callback.headers).get("location")).toBe("/admin/login?step=mfa");
    expect(new Headers(setup.callback.headers).get("set-cookie")).not.toContain("nr_admin_session=");
    expect(responseCookie(setup.callback, "nr_admin_mfa_pending")).not.toContain(token({ aal: "aal1" }));
    expect(setup.challenged).toMatchObject({ status: 200, body: { challengeId: setup.pendingInput.challengeId } });
    const result = await handleAdminMfa("verify", setup.pendingInput, config, setup.dependencies, setup.resolve);
    expect(result.status).toBe(204);
    expect(new Headers(result.headers).get("set-cookie")).toContain("nr_admin_session=");
    expect(responseCookie(result, "nr_admin_mfa_pending")).toBe("");
    expect(setup.resolve).toHaveBeenCalledWith(token());
  });

  it.each(["forged-cookie", "wrong-csrf", "expired", "expired-challenge", "wrong-challenge", "wrong-code", "unmapped", "subject-substitution"])("rejects MFA %s without setting an admin session", async (mode) => {
    const setup = await pendingFixture({ wrongCode: mode === "wrong-code", unmapped: mode === "unmapped", changedSubject: mode === "subject-substitution" });
    const input = { ...setup.pendingInput };
    if (mode === "forged-cookie") input.pendingCookie = `${input.pendingCookie[0] === "A" ? "B" : "A"}${input.pendingCookie.slice(1)}`;
    if (mode === "wrong-csrf") input.csrfHeader = "other-csrf";
    if (mode === "expired") setup.dependencies.now = () => new Date(now.getTime() + 301_000);
    if (mode === "expired-challenge") setup.dependencies.now = () => new Date(now.getTime() + 121_000);
    if (mode === "wrong-challenge") input.challengeId = "30000000-0000-4000-8000-000000000001";
    const result = await handleAdminMfa("verify", input, config, setup.dependencies, setup.resolve);
    expect(result.status).toBe(mode === "wrong-csrf" ? 403 : 401);
    expect(new Headers(result.headers).get("set-cookie") ?? "").not.toContain("nr_admin_session=");
    expect(JSON.stringify(result.body)).not.toContain("private-provider-error");
  });

  it("rejects a consumed MFA challenge replay", async () => {
    const setup = await pendingFixture();
    expect((await handleAdminMfa("verify", setup.pendingInput, config, setup.dependencies, setup.resolve)).status).toBe(204);
    const replay = await handleAdminMfa("verify", setup.pendingInput, config, setup.dependencies, setup.resolve);
    expect(replay.status).toBe(401);
    expect(new Headers(replay.headers).get("set-cookie")).not.toContain("nr_admin_session=");
  });
});
