import { describe, expect, it, vi } from "vitest";

import { handleApiRequest } from "../../src/lib/server/api-router";
import { createMemoryRateLimiter, sha256 } from "../../src/lib/server/security";
import { OperationUnavailable, type ApiOperations, type Principal } from "../../src/services/api-operations";

const origin = "https://rental.example";
const customer: Principal = {
  kind: "customer",
  id: "10000000-0000-4000-8000-000000000001",
  csrfHash: sha256("csrf-test-token"),
};
const owner: Principal = {
  kind: "admin",
  id: "90000000-0000-4000-8000-000000000001",
  roles: ["OWNER"],
  mfaVerified: true,
  mfaVerifiedAt: "2026-07-13T09:55:00.000Z",
};

function operations(principals: Record<string, Principal> = {}): ApiOperations & { execute: ReturnType<typeof vi.fn> } {
  return {
    async resolveSession(_kind, token) { return principals[token] ?? null; },
    execute: vi.fn(async (operation) => ({ status: ["listLaptops", "verifyRentalKyc"].includes(operation) ? 200 : 201, body: { operation } })),
  };
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`${origin}${path}`, init);
}

function deps(api: ApiOperations) {
  return {
    operations: api,
    trustedOrigins: new Set([origin]),
    requestId: () => "request-test-1",
    now: () => new Date("2026-07-13T10:00:00.000Z"),
  };
}

describe("A02 API trust boundaries", () => {
  it("dispatches admin login and a cookie-bound callback without trusting query roles or redirect targets", async () => {
    const api = operations();
    await handleApiRequest(request("/api/v1/admin/auth/login"), deps(api));
    expect(api.execute).toHaveBeenCalledWith("startAdminLogin", {}, { requestId: "request-test-1", principal: null });
    await handleApiRequest(request("/api/v1/admin/auth/callback?code=synthetic-code&state=synthetic-state&role=OWNER", { headers: { cookie: "nr_admin_oauth=binding" } }), deps(api));
    expect(api.execute).toHaveBeenLastCalledWith("completeAdminLogin", { code: "synthetic-code", state: "synthetic-state", oauthCookie: "binding", invalidQuery: true }, { requestId: "request-test-1", principal: null });
  });
  it("dispatches the public catalog with bounded query values", async () => {
    const api = operations();
    const response = await handleApiRequest(request("/api/v1/laptops?limit=10"), deps(api));
    expect(response.status).toBe(200);
    expect(api.execute).toHaveBeenCalledWith(
      "listLaptops",
      { limit: 10 },
      { requestId: "request-test-1", principal: null },
    );
  });

  it.each([
    ["/api/v1/rentals", "customer", "listOwnRentals"],
    ["/api/v1/admin/auth/session", "admin", "getAdminSession"],
  ] as const)("selects only the explicit namespace for %s with both session cookies", async (path, kind, operation) => {
    const api = operations({ customer, admin: owner });
    const resolve = vi.spyOn(api, "resolveSession");
    const response = await handleApiRequest(request(path, { headers: { cookie: "nr_customer_session=customer; nr_admin_session=admin" } }), deps(api));
    expect(response.status).toBe(201);
    expect(resolve).toHaveBeenCalledExactlyOnceWith(kind, kind);
    expect(api.execute).toHaveBeenCalledWith(operation, expect.anything(), expect.objectContaining({ principal: kind === "customer" ? customer : owner }));
  });

  it.each([
    ["/api/v1/rentals", "nr_admin_session=admin"],
    ["/api/v1/rentals", "nr_customer_session=expired; nr_admin_session=admin"],
    ["/api/v1/rentals", "nr_customer_session=admin; nr_admin_session=admin"],
    ["/api/v1/admin/auth/session", "nr_customer_session=customer"],
    ["/api/v1/admin/auth/session", "nr_customer_session=customer; nr_admin_session=expired"],
    ["/api/v1/admin/auth/session", "nr_customer_session=customer; nr_admin_session=customer"],
    ["/api/v1/rentals", ""],
  ])("does not substitute another namespace for a missing or invalid session on %s (%s)", async (path, cookie) => {
    const api = operations({ customer, admin: owner });
    const response = await handleApiRequest(request(path, { headers: { cookie } }), deps(api));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("AUTH_REQUIRED");
    expect(api.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["/api/v1/auth/session", "csrf-test-token", "deleteCurrentSession", customer],
    ["/api/v1/admin/auth/session", "admin-csrf-token", "deleteAdminSession", { ...owner, csrfToken: "admin-csrf-token" }],
  ] as const)("keeps mutation CSRF bound to the explicit namespace on %s", async (path, csrf, operation, principal) => {
    const api = operations({ customer, admin: { ...owner, csrfToken: "admin-csrf-token" } });
    const headers = { origin, cookie: "nr_customer_session=customer; nr_admin_session=admin; nr_csrf=csrf-test-token; nr_admin_csrf=admin-csrf-token" };
    const valid = await handleApiRequest(request(path, { method: "DELETE", headers: { ...headers, "x-csrf-token": csrf } }), deps(api));
    expect(valid.status).toBe(201);
    expect(api.execute).toHaveBeenCalledExactlyOnceWith(operation, {}, expect.objectContaining({ principal }));
    api.execute.mockClear();
    const invalid = await handleApiRequest(request(path, { method: "DELETE", headers: { ...headers, "x-csrf-token": csrf === "csrf-test-token" ? "admin-csrf-token" : "csrf-test-token" } }), deps(api));
    expect(invalid.status).toBe(403);
    expect(api.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["both/customer", "nr_customer_session=customer; nr_admin_session=admin", "csrf-test-token", customer],
    ["both/admin", "nr_customer_session=customer; nr_admin_session=admin", "admin-csrf-token", { ...owner, csrfToken: "admin-csrf-token" }],
    ["customer only", "nr_customer_session=customer", "csrf-test-token", customer],
    ["admin only", "nr_admin_session=admin", "admin-csrf-token", { ...owner, csrfToken: "admin-csrf-token" }],
    ["expired other", "nr_customer_session=expired; nr_admin_session=admin", "admin-csrf-token", { ...owner, csrfToken: "admin-csrf-token" }],
  ] as const)("finalizes as exactly the session with matching bound CSRF (%s)", async (_name, sessions, csrf, principal) => {
    const api = operations({ customer, admin: { ...owner, csrfToken: "admin-csrf-token" } });
    const response = await handleApiRequest(request("/api/v1/uploads/70000000-0000-4000-8000-000000000001/finalize", {
      method: "POST",
      headers: { origin, cookie: `${sessions}; nr_csrf=csrf-test-token; nr_admin_csrf=admin-csrf-token`, "x-csrf-token": csrf, "idempotency-key": "upload:0123456789" },
    }), deps(api));
    expect(response.status).toBe(201);
    expect(api.execute).toHaveBeenCalledExactlyOnceWith("finalizeUpload", { uploadId: "70000000-0000-4000-8000-000000000001" }, expect.objectContaining({ principal, idempotencyKey: "upload:0123456789" }));
  });

  it.each([
    ["missing header", "nr_csrf=csrf-test-token; nr_admin_csrf=admin-csrf-token", ""],
    ["missing CSRF cookies", "", "csrf-test-token"],
    ["wrong header", "nr_csrf=csrf-test-token; nr_admin_csrf=admin-csrf-token", "wrong-token"],
    ["unbound customer cookie", "nr_csrf=forged; nr_admin_csrf=admin-csrf-token", "forged"],
    ["unbound admin cookie", "nr_csrf=csrf-test-token; nr_admin_csrf=forged", "forged"],
    ["cross-namespace cookie", "nr_csrf=admin-csrf-token; nr_admin_csrf=csrf-test-token", "csrf-test-token"],
  ])("denies finalize without exactly one authenticated CSRF match (%s)", async (_name, csrfCookies, csrf) => {
    const api = operations({ customer, admin: { ...owner, csrfToken: "admin-csrf-token" } });
    const response = await handleApiRequest(request("/api/v1/uploads/70000000-0000-4000-8000-000000000001/finalize", {
      method: "POST",
      headers: { origin, cookie: `nr_customer_session=customer; nr_admin_session=admin; ${csrfCookies}`, ...(csrf ? { "x-csrf-token": csrf } : {}), "idempotency-key": "upload:0123456789" },
    }), deps(api));
    expect(response.status).toBe(403);
    expect(api.execute).not.toHaveBeenCalled();
  });

  it("denies ambiguous finalize CSRF instead of preferring either authenticated session", async () => {
    const api = operations({ customer, admin: { ...owner, csrfToken: "csrf-test-token" } });
    const response = await handleApiRequest(request("/api/v1/uploads/70000000-0000-4000-8000-000000000001/finalize", {
      method: "POST",
      headers: { origin, cookie: "nr_customer_session=customer; nr_admin_session=admin; nr_csrf=csrf-test-token; nr_admin_csrf=csrf-test-token", "x-csrf-token": "csrf-test-token", "idempotency-key": "upload:0123456789" },
    }), deps(api));
    expect(response.status).toBe(403);
    expect(api.execute).not.toHaveBeenCalled();
  });

  it.each(["", "nr_customer_session=expired; nr_admin_session=expired", "nr_customer_session=admin; nr_admin_session=customer"])("denies finalize without an authenticated namespace (%s)", async (sessions) => {
    const api = operations({ customer, admin: owner });
    const response = await handleApiRequest(request("/api/v1/uploads/70000000-0000-4000-8000-000000000001/finalize", {
      method: "POST",
      headers: { origin, cookie: `${sessions}; nr_csrf=csrf-test-token`, "x-csrf-token": "csrf-test-token", "idempotency-key": "upload:0123456789" },
    }), deps(api));
    expect(response.status).toBe(401);
    expect(api.execute).not.toHaveBeenCalled();
  });

  it("rejects cross-origin cookie mutations before processing input", async () => {
    const api = operations({ customer });
    const response = await handleApiRequest(
      request("/api/v1/rentals", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: "nr_customer_session=customer", origin: "https://evil.example" },
        body: JSON.stringify({}),
      }),
      deps(api),
    );
    expect((await response.json()).error.code).toBe("FORBIDDEN");
    expect(api.execute).not.toHaveBeenCalled();
  });

  it("rejects client-authoritative price/status and requires idempotency", async () => {
    const api = operations({ customer });
    const headers = { "content-type": "application/json", cookie: "nr_customer_session=customer", origin };
    const injected = await handleApiRequest(
      request("/api/v1/rentals", {
        method: "POST",
        headers,
        body: JSON.stringify({
          quoteId: "20000000-0000-4000-8000-000000000001",
          customer: { name: "Customer", phone: "0812345678" },
          totalDueSatang: 1,
          status: "APPROVED",
        }),
      }),
      deps(api),
    );
    expect((await injected.json()).error.code).toBe("VALIDATION_ERROR");

    const noKey = await handleApiRequest(
      request("/api/v1/rentals", {
        method: "POST",
        headers,
        body: JSON.stringify({
          quoteId: "20000000-0000-4000-8000-000000000001",
          customer: { name: "Customer", phone: "0812345678" },
        }),
      }),
      deps(api),
    );
    expect((await noKey.json()).error.code).toBe("VALIDATION_ERROR");
    expect(api.execute).not.toHaveBeenCalled();
  });

  it("passes only validated booking input and server-derived principal", async () => {
    const api = operations({ customer });
    const response = await handleApiRequest(
      request("/api/v1/rentals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "nr_customer_session=customer; nr_csrf=csrf-test-token",
          origin,
          "idempotency-key": "booking:0123456789",
          "x-csrf-token": "csrf-test-token",
        },
        body: JSON.stringify({
          quoteId: "20000000-0000-4000-8000-000000000001",
          customer: { name: " Customer ", phone: "0812345678" },
        }),
      }),
      deps(api),
    );
    expect(response.status).toBe(201);
    expect(api.execute).toHaveBeenCalledWith(
      "createRental",
      {
        quoteId: "20000000-0000-4000-8000-000000000001",
        customer: { name: "Customer", phone: "0812345678" },
      },
      {
        requestId: "request-test-1",
        principal: customer,
        idempotencyKey: "booking:0123456789",
      },
    );
  });

  it("requires a session-bound CSRF token on same-origin mutations", async () => {
    const api = operations({ customer });
    const response = await handleApiRequest(
      request("/api/v1/rentals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "nr_customer_session=customer; nr_csrf=wrong-token",
          origin,
          "idempotency-key": "booking:0123456789",
          "x-csrf-token": "wrong-token",
        },
        body: JSON.stringify({
          quoteId: "20000000-0000-4000-8000-000000000001",
          customer: { name: "Customer", phone: "0812345678" },
        }),
      }),
      deps(api),
    );
    expect((await response.json()).error.code).toBe("FORBIDDEN");
    expect(api.execute).not.toHaveBeenCalled();
  });

  it("dispatches independent KYC review with reviewer gates and version headers", async () => {
    const reviewer: Principal = {
      kind: "admin",
      id: owner.id,
      roles: ["REVIEWER"],
      mfaVerified: true,
      csrfToken: "admin-csrf-token",
    };
    const api = operations({ reviewer });
    const response = await handleApiRequest(
      request("/api/v1/admin/rentals/40000000-0000-4000-8000-000000000001/kyc/verify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "nr_admin_session=reviewer; nr_admin_csrf=admin-csrf-token",
          origin,
          "idempotency-key": "kyc-review:0123456789",
          "if-match": "v4",
          "x-csrf-token": "admin-csrf-token",
        },
        body: JSON.stringify({ evidenceIds: ["60000000-0000-4000-8000-000000000001"] }),
      }),
      deps(api),
    );
    expect(response.status).toBe(200);
    expect(api.execute).toHaveBeenCalledWith(
      "verifyRentalKyc",
      { rentalId: "40000000-0000-4000-8000-000000000001", evidenceIds: ["60000000-0000-4000-8000-000000000001"] },
      { requestId: "request-test-1", principal: reviewer, idempotencyKey: "kyc-review:0123456789", ifMatch: "v4" },
    );
  });

  it("allows laptop retirement only for Owner", async () => {
    const operationsAdmin: Principal = { ...owner, roles: ["OPERATIONS"], csrfToken: "admin-csrf-token" };
    const api = operations({ operations: operationsAdmin });
    const response = await handleApiRequest(
      request("/api/v1/admin/laptops/30000000-0000-4000-8000-000000000001", {
        method: "DELETE",
        headers: {
          cookie: "nr_admin_session=operations; nr_admin_csrf=admin-csrf-token",
          origin,
          "idempotency-key": "retire:0123456789",
          "if-match": "v1",
          "x-csrf-token": "admin-csrf-token",
        },
      }),
      deps(api),
    );
    expect(response.status).toBe(403);
    expect(api.execute).not.toHaveBeenCalled();
  });

  it("rate-limits repeated bootstrap attempts per instance", async () => {
    const api = operations();
    const limiter = createMemoryRateLimiter();
    const limitedDeps = { ...deps(api), rateLimiter: limiter };
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await handleApiRequest(request("/api/v1/auth/line/bootstrap", { method: "POST", headers: { origin } }), limitedDeps)).status).toBe(201);
    }
    const blocked = await handleApiRequest(request("/api/v1/auth/line/bootstrap", { method: "POST", headers: { origin } }), limitedDeps);
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.code).toBe("RATE_LIMITED");
  });

  it("enforces admin role and recent MFA for financial mutations", async () => {
    const viewer: Principal = { kind: "admin", id: owner.id, roles: ["VIEWER"], mfaVerified: true, mfaVerifiedAt: "2026-07-13T09:55:00.000Z" };
    const staleOwner: Principal = { ...owner, mfaVerifiedAt: "2026-07-13T09:00:00.000Z" };
    const headers = {
      "content-type": "application/json",
      origin,
      "idempotency-key": "refund:0123456789",
    };
    const body = JSON.stringify({ amountSatang: 100, reason: "คืนยอดคงเหลือ" });
    const viewerResponse = await handleApiRequest(
      request("/api/v1/admin/rentals/40000000-0000-4000-8000-000000000001/refunds", {
        method: "POST", headers: { ...headers, cookie: "nr_admin_session=viewer" }, body,
      }),
      deps(operations({ viewer })),
    );
    const staleResponse = await handleApiRequest(
      request("/api/v1/admin/rentals/40000000-0000-4000-8000-000000000001/refunds", {
        method: "POST", headers: { ...headers, cookie: "nr_admin_session=stale" }, body,
      }),
      deps(operations({ stale: staleOwner })),
    );
    expect((await viewerResponse.json()).error.code).toBe("FORBIDDEN");
    expect((await staleResponse.json()).error.code).toBe("FORBIDDEN");
  });

  it("fails closed without the missing persistence capability", async () => {
    const api: ApiOperations = {
      async resolveSession() { return customer; },
      async execute() { throw new OperationUnavailable("missing RPC"); },
    };
    const response = await handleApiRequest(request("/api/v1/laptops"), deps(api));
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error).toMatchObject({ code: "INTERNAL_ERROR", requestId: "request-test-1" });
    expect(JSON.stringify(body)).not.toContain("missing RPC");
  });
  it("dispatches inventory and settlement additions with version, role and recent-MFA guards", async () => {
    const principal: Principal = { ...owner, csrfToken: "admin-csrf-token" };
    const api = operations({ owner: principal });
    const headers = { origin, cookie: "nr_admin_session=owner; nr_admin_csrf=admin-csrf-token", "x-csrf-token": "admin-csrf-token", "content-type": "application/json", "idempotency-key": "financial:0123456789", "if-match": '"4"' };
    const rentalId = "40000000-0000-4000-8000-000000000001";
    const refundId = "50000000-0000-4000-8000-000000000001";
    await handleApiRequest(request(`/api/v1/admin/rentals/${rentalId}/refunds/${refundId}/confirm`, { method: "POST", headers, body: JSON.stringify({ amountSatang: 100, providerReference: "synthetic-bank-reference", reason: "Transfer completed" }) }), deps(api));
    expect(api.execute).toHaveBeenLastCalledWith("confirmRentalRefund", expect.objectContaining({ rentalId, refundId, amountSatang: 100 }), expect.objectContaining({ ifMatch: '"4"', idempotencyKey: "financial:0123456789", principal }));
    await handleApiRequest(request(`/api/v1/admin/laptops/${rentalId}/status`, { method: "POST", headers, body: JSON.stringify({ status: "MAINTENANCE", reason: "Battery inspection" }) }), deps(api));
    expect(api.execute).toHaveBeenLastCalledWith("setAdminLaptopStatus", expect.objectContaining({ status: "MAINTENANCE" }), expect.objectContaining({ ifMatch: '"4"' }));
    const missingReason = await handleApiRequest(request(`/api/v1/admin/rentals/${rentalId}/commands/request-return`, { method: "POST", headers, body: "{}" }), deps(api));
    expect(missingReason.status).toBe(422);
  });

  it("keeps public settings public and rejects unsafe setting values or cross-origin MFA", async () => {
    const api = operations({ owner: { ...owner, csrfToken: "admin-csrf-token" } });
    await handleApiRequest(request("/api/v1/public-settings"), deps(api));
    expect(api.execute).toHaveBeenLastCalledWith("getCustomerPublicSettings", {}, { requestId: "request-test-1", principal: null });
    const unsafe = await handleApiRequest(request("/api/v1/admin/settings", { method: "PATCH", headers: { origin, "content-type": "application/json", cookie: "nr_admin_session=owner" }, body: JSON.stringify({ key: "CONTACT_LINE_URL", value: "https://evil.example" }) }), deps(api));
    expect(unsafe.status).toBe(422);
    const crossOrigin = await handleApiRequest(request("/api/v1/admin/auth/mfa/verify", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ challengeId: "50000000-0000-4000-8000-000000000001", code: "123456" }) }), deps(api));
    expect(crossOrigin.status).toBe(403);
  });
});
