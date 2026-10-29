import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "../../src/proxy";

afterEach(() => vi.unstubAllEnvs());
describe("HTML CSP nonce boundary", () => {
  it("replaces untrusted nonce headers with a fresh nonce per uncached response", () => {
    vi.stubEnv("NODE_ENV", "production");
    const first = proxy(new NextRequest("https://app.test/", { headers: { "x-nonce": "attacker", "content-security-policy": "script-src *" } }));
    const second = proxy(new NextRequest("https://app.test/"));
    const policy = first.headers.get("content-security-policy")!;
    expect(policy).toContain("'strict-dynamic'");
    expect(policy.split(";").find((part) => part.trim().startsWith("script-src"))).not.toMatch(/unsafe-inline|unsafe-eval|attacker/);
    expect(policy).not.toBe(second.headers.get("content-security-policy"));
    expect(first.headers.get("x-middleware-request-x-nonce")).toBe(policy.match(/'nonce-([^']+)'/)?.[1]);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
  });
  it("denies admin framing and grants only the configured HTTPS storage connection origin", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage.test/project-path");
    const policy = proxy(new NextRequest("https://app.test/admin/rentals")).headers.get("content-security-policy")!;
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("https://storage.test");
    expect(policy).not.toContain("/project-path");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://name:password@untrusted.test/");
    expect(proxy(new NextRequest("https://app.test/")).headers.get("content-security-policy")).not.toContain("untrusted.test");
  });
});
