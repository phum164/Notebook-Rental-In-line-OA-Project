import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { AdminRole } from "@/types/domain";
import type {
  AdminPrincipal,
  ApiOperation,
  ApiOperations,
  OperationResult,
  Principal,
} from "../../services/api-operations";
import { OperationUnavailable } from "../../services/api-operations";
import { runtimeSupabaseOperations } from "../../services/supabase-api-operations";
import {
  adminLaptopQuerySchema,
  adminMfaChallengeSchema,
  adminMfaVerifySchema,
  adminRentalQuerySchema,
  auditQuerySchema,
  catalogQuerySchema,
  contractAcceptanceSchema,
  contractPublishSchema,
  createRentalSchema,
  feeSchema,
  idempotencyKeySchema,
  inspectionSchema,
  laptopMutationSchema,
  laptopStatusSchema,
  laptopImageSchema,
  lineSessionSchema,
  paginationSchema,
  pathUuidSchema,
  paymentSubmissionSchema,
  quoteSchema,
  refundSchema,
  refundConfirmationSchema,
  rejectKycCommandSchema,
  rejectPaymentCommandSchema,
  rentalCommandSchema,
  settingSchema,
  uploadIntentSchema,
  verifyKycCommandSchema,
  verifyPaymentCommandSchema,
} from "../../validators/api";
import { ApiFailure, errorResponse } from "./api-errors";
import { createMemoryRateLimiter, safeEqual, sha256, type RateLimiter } from "./security";

type ApiDependencies = {
  operations: ApiOperations;
  trustedOrigins: ReadonlySet<string>;
  requestId?: () => string;
  now?: () => Date;
  rateLimiter?: RateLimiter;
};

const commands = [
  "approve",
  "reject",
  "start-preparation",
  "mark-ready",
  "handover",
  "request-return",
  "receive-return",
  "finalize-inspection",
  "complete-settlement",
] as const;

type Command = (typeof commands)[number];

function validationFailure(error: z.ZodError): ApiFailure {
  return new ApiFailure(
    "VALIDATION_ERROR",
    "Request validation failed",
    error.issues.map((issue) => ({
      ...(issue.path.length ? { field: issue.path.join(".") } : {}),
      reason: issue.message,
    })),
  );
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw validationFailure(result.error);
  return result.data;
}

function queryObject(url: URL): Record<string, string> {
  const query: Record<string, string> = {};
  for (const key of url.searchParams.keys()) {
    const values = url.searchParams.getAll(key);
    if (values.length !== 1) throw new ApiFailure("VALIDATION_ERROR", `Duplicate query parameter: ${key}`);
    query[key] = values[0]!;
  }
  return query;
}

async function jsonBody(request: Request, optional = false): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > 1_048_576) {
    throw new ApiFailure("VALIDATION_ERROR", "Request body is too large");
  }
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!contentType && optional) return {};
  if (contentType !== "application/json") {
    throw new ApiFailure("VALIDATION_ERROR", "Content-Type must be application/json");
  }
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 1_048_576) {
      throw new ApiFailure("VALIDATION_ERROR", "Request body is too large");
    }
    if (!text && optional) return {};
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    throw new ApiFailure("VALIDATION_ERROR", "Request body must be valid JSON");
  }
}

function cookies(request: Request): Record<string, string> {
  return Object.fromEntries(
    (request.headers.get("cookie") ?? "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const separator = item.indexOf("=");
        return separator < 0 ? [item, ""] : [item.slice(0, separator), decodeURIComponent(item.slice(separator + 1))];
      }),
  );
}

function enforceSameOrigin(request: Request, trustedOrigins: ReadonlySet<string>): void {
  const origin = request.headers.get("origin");
  if (!origin || !trustedOrigins.has(origin)) {
    throw new ApiFailure("FORBIDDEN", "Request origin is not allowed");
  }
}

function matchesCsrf(request: Request, principal: Principal): boolean {
  const token = request.headers.get("x-csrf-token");
  const values = cookies(request);
  const cookieToken = principal.kind === "customer" ? values.nr_csrf : values.nr_admin_csrf;
  if (!token || !cookieToken || !safeEqual(token, cookieToken)) {
    return false;
  }
  return principal.kind === "customer"
    ? Boolean(principal.csrfHash && safeEqual(sha256(token), principal.csrfHash))
    : Boolean(principal.csrfToken && safeEqual(token, principal.csrfToken));
}

function enforceCsrf(request: Request, principal: Principal): void {
  if (!matchesCsrf(request, principal)) throw new ApiFailure("FORBIDDEN", "CSRF validation failed");
}

function rateLimitKey(request: Request, path: string): string {
  const values = cookies(request);
  const credential = values.nr_customer_session ?? values.nr_admin_session ?? values.nr_line_bootstrap ?? "anonymous";
  const network = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ?? "unknown";
  return sha256(`${path}:${credential}:${network}:${request.headers.get("user-agent") ?? "unknown"}`);
}

async function principalFor(
  request: Request,
  operations: ApiOperations,
  kind: Principal["kind"],
): Promise<Principal> {
  const values = cookies(request);
  const token = kind === "customer" ? values.nr_customer_session : values.nr_admin_session;
  const principal = token ? await operations.resolveSession(kind, token) : null;
  if (!principal || principal.kind !== kind) throw new ApiFailure("AUTH_REQUIRED", "A valid session is required");
  return principal;
}

async function eitherPrincipal(request: Request, operations: ApiOperations): Promise<Principal> {
  const values = cookies(request);
  const candidates = await Promise.all((["customer", "admin"] as const).map(async (kind) => {
    const token = kind === "customer" ? values.nr_customer_session : values.nr_admin_session;
    const principal = token ? await operations.resolveSession(kind, token) : null;
    return principal?.kind === kind ? principal : null;
  }));
  const authenticated = candidates.filter((principal): principal is Principal => principal !== null);
  if (!authenticated.length) throw new ApiFailure("AUTH_REQUIRED", "A valid session is required");
  const matching = authenticated.filter((principal) => matchesCsrf(request, principal));
  if (matching.length !== 1) throw new ApiFailure("FORBIDDEN", "Exactly one session-bound CSRF token is required");
  return matching[0]!;
}

function adminWithRoles(principal: Principal, roles: readonly AdminRole[], recentMfa: boolean, now: Date): AdminPrincipal {
  if (
    principal.kind !== "admin" ||
    !principal.mfaVerified ||
    !principal.roles.some((role) => roles.includes(role))
  ) {
    throw new ApiFailure("FORBIDDEN", "The current admin is not permitted");
  }
  if (recentMfa) {
    const verifiedAt = principal.mfaVerifiedAt ? Date.parse(principal.mfaVerifiedAt) : Number.NaN;
    const age = now.getTime() - verifiedAt;
    if (!Number.isFinite(verifiedAt) || age < 0 || age > 15 * 60_000) {
      throw new ApiFailure("FORBIDDEN", "Recent MFA is required");
    }
  }
  return principal;
}

function requiredIdempotency(request: Request): string {
  return parse(idempotencyKeySchema, request.headers.get("idempotency-key"));
}

function requiredVersion(request: Request): string {
  const value = request.headers.get("if-match")?.trim();
  if (!value) throw new ApiFailure("VALIDATION_ERROR", "If-Match is required");
  return value;
}

function uuid(value: string): string {
  return parse(pathUuidSchema, value);
}

function responseFor(result: OperationResult, requestId: string): Response {
  const headers = new Headers(result.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Request-Id", requestId);
  if (result.status === 204) return new Response(null, { status: 204, headers });
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(result.body ?? null), { status: result.status, headers });
}

export async function handleApiRequest(request: Request, dependencies: ApiDependencies): Promise<Response> {
  const requestId = dependencies.requestId?.() ?? randomUUID();
  const now = dependencies.now?.() ?? new Date();
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = request.method.toUpperCase();

  const execute = async (
    operation: ApiOperation,
    input: unknown,
    principal: Principal | null,
    idempotencyKey?: string,
    ifMatch?: string,
  ): Promise<Response> => {
    try {
      if (["POST", "PATCH", "DELETE"].includes(method) && principal) enforceCsrf(request, principal);
      return responseFor(
        await dependencies.operations.execute(operation, input, {
          requestId,
          principal,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          ...(ifMatch ? { ifMatch } : {}),
          ...(request.headers.get("user-agent") ? { userAgentHash: sha256(request.headers.get("user-agent")!) } : {}),
        }),
        requestId,
      );
    } catch (error) {
      if (error instanceof ApiFailure) return errorResponse(error, requestId);
      if (error instanceof OperationUnavailable) {
        return errorResponse(new ApiFailure("INTERNAL_ERROR", "Required persistence capability is unavailable"), requestId);
      }
      return errorResponse(new ApiFailure("INTERNAL_ERROR", "Unexpected server error"), requestId);
    }
  };

  try {
    if (method === "GET" && path === "/api/v1/admin/auth/login") {
      return execute("startAdminLogin", {}, null);
    }
    if (method === "GET" && path === "/api/v1/admin/auth/callback") {
      let oauthCookie: string | undefined;
      let invalidQuery = [...url.searchParams.keys()].some((key) => !["code", "state"].includes(key) || url.searchParams.getAll(key).length !== 1);
      try { oauthCookie = cookies(request).nr_admin_oauth; } catch { invalidQuery = true; }
      return execute("completeAdminLogin", {
        code: url.searchParams.get("code") ?? undefined, state: url.searchParams.get("state") ?? undefined, oauthCookie,
        invalidQuery,
      }, null);
    }
    if (["POST", "PATCH", "DELETE"].includes(method)) enforceSameOrigin(request, dependencies.trustedOrigins);
    if (["POST", "PATCH", "DELETE"].includes(method) && dependencies.rateLimiter) {
      const bootstrap = path === "/api/v1/auth/line/bootstrap" || path === "/api/v1/auth/line/session" || path.startsWith("/api/v1/admin/auth/mfa/");
      const highRisk = bootstrap || /\/(refunds|fee-obligations|signed-read)$/.test(path) || path === "/api/v1/admin/settings";
      if (!dependencies.rateLimiter.consume(rateLimitKey(request, path), highRisk ? 10 : 30, bootstrap ? 600_000 : 60_000, now.getTime())) {
        throw new ApiFailure("RATE_LIMITED", "Too many requests");
      }
    }

    if (method === "POST" && ["/api/v1/admin/auth/mfa/challenge", "/api/v1/admin/auth/mfa/verify"].includes(path)) {
      const verify = path.endsWith("/verify");
      const values = cookies(request);
      return execute(verify ? "verifyAdminMfa" : "challengeAdminMfa", {
        ...parse(verify ? adminMfaVerifySchema : adminMfaChallengeSchema, await jsonBody(request, !verify)),
        pendingCookie: values.nr_admin_mfa_pending, csrfCookie: values.nr_admin_mfa_csrf, csrfHeader: request.headers.get("x-csrf-token"),
      }, null);
    }

    if (method === "POST" && path === "/api/v1/auth/line/bootstrap") {
      return execute("createLineBootstrap", {}, null);
    }

    if (method === "POST" && path === "/api/v1/auth/line/session") {
      return execute(
        "createLineSession",
        { ...parse(lineSessionSchema, await jsonBody(request)), browserBinding: cookies(request).nr_line_bootstrap },
        null,
      );
    }
    if (method === "DELETE" && path === "/api/v1/auth/session") {
      const principal = await principalFor(request, dependencies.operations, "customer");
      return execute("deleteCurrentSession", {}, principal);
    }
    if (method === "GET" && path === "/api/v1/laptops") {
      return execute("listLaptops", parse(catalogQuerySchema, queryObject(url)), null);
    }
    if (method === "GET" && path === "/api/v1/public-settings") return execute("getCustomerPublicSettings", {}, null);
    const laptop = path.match(/^\/api\/v1\/laptops\/([^/]+)$/);
    if (method === "GET" && laptop) return execute("getLaptop", { laptopId: uuid(laptop[1]!) }, null);

    if (method === "GET" && path === "/api/v1/contracts/current") {
      return execute("getCurrentContract", {}, await principalFor(request, dependencies.operations, "customer"));
    }
    if (method === "GET" && path === "/api/v1/payment-settings") {
      return execute("getPaymentSettings", {}, await principalFor(request, dependencies.operations, "customer"));
    }
    if (method === "POST" && path === "/api/v1/quotes") {
      return execute("createQuote", parse(quoteSchema, await jsonBody(request)), await principalFor(request, dependencies.operations, "customer"));
    }
    if (method === "GET" && path === "/api/v1/rentals") {
      return execute("listOwnRentals", parse(paginationSchema, queryObject(url)), await principalFor(request, dependencies.operations, "customer"));
    }
    if (method === "POST" && path === "/api/v1/rentals") {
      return execute(
        "createRental",
        parse(createRentalSchema, await jsonBody(request)),
        await principalFor(request, dependencies.operations, "customer"),
        requiredIdempotency(request),
      );
    }
    const ownRental = path.match(/^\/api\/v1\/rentals\/([^/]+)$/);
    if (method === "GET" && ownRental) {
      return execute("getOwnRental", { rentalId: uuid(ownRental[1]!) }, await principalFor(request, dependencies.operations, "customer"));
    }
    const acceptance = path.match(/^\/api\/v1\/rentals\/([^/]+)\/contract-acceptance$/);
    if (method === "POST" && acceptance) {
      return execute(
        "acceptRentalContract",
        { rentalId: uuid(acceptance[1]!), ...parse(contractAcceptanceSchema, await jsonBody(request)) },
        await principalFor(request, dependencies.operations, "customer"),
        requiredIdempotency(request),
      );
    }
    const payment = path.match(/^\/api\/v1\/rentals\/([^/]+)\/payments$/);
    if (method === "POST" && payment) {
      return execute(
        "submitRentalPayment",
        { rentalId: uuid(payment[1]!), ...parse(paymentSubmissionSchema, await jsonBody(request)) },
        await principalFor(request, dependencies.operations, "customer"),
        requiredIdempotency(request),
      );
    }
    if (method === "POST" && path === "/api/v1/uploads/intents") {
      const body = parse(uploadIntentSchema, await jsonBody(request));
      const principal = body.purpose === "KYC_ID" || body.purpose === "PAYMENT_SLIP"
        ? await principalFor(request, dependencies.operations, "customer")
        : adminWithRoles(await principalFor(request, dependencies.operations, "admin"), ["OWNER", "OPERATIONS"], false, now);
      return execute("createUploadIntent", body, principal);
    }
    const finalize = path.match(/^\/api\/v1\/uploads\/([^/]+)\/finalize$/);
    if (method === "POST" && finalize) {
      return execute(
        "finalizeUpload",
        { uploadId: uuid(finalize[1]!) },
        await eitherPrincipal(request, dependencies.operations),
        requiredIdempotency(request),
      );
    }

    if (path === "/api/v1/admin/auth/session" && method === "GET") {
      const principal = adminWithRoles(await principalFor(request, dependencies.operations, "admin"), ["OWNER", "OPERATIONS", "REVIEWER", "VIEWER"], false, now);
      return execute("getAdminSession", {}, principal);
    }
    if (path === "/api/v1/admin/auth/session" && method === "DELETE") {
      const principal = await principalFor(request, dependencies.operations, "admin");
      return execute("deleteAdminSession", {}, principal);
    }

    const anyAdmin = async () => adminWithRoles(
      await principalFor(request, dependencies.operations, "admin"),
      ["OWNER", "OPERATIONS", "REVIEWER", "VIEWER"],
      false,
      now,
    );
    const privilegedAdmin = async (roles: readonly AdminRole[], recentMfa = false) => adminWithRoles(
      await principalFor(request, dependencies.operations, "admin"), roles, recentMfa, now,
    );

    if (path === "/api/v1/admin/rentals" && method === "GET") {
      return execute("listAdminRentals", parse(adminRentalQuerySchema, queryObject(url)), await anyAdmin());
    }
    const adminRental = path.match(/^\/api\/v1\/admin\/rentals\/([^/]+)$/);
    if (adminRental && method === "GET") {
      return execute("getAdminRental", { rentalId: uuid(adminRental[1]!) }, await anyAdmin());
    }
    if (path === "/api/v1/admin/laptops" && method === "GET") {
      return execute("listAdminLaptops", parse(adminLaptopQuerySchema, queryObject(url)), await anyAdmin());
    }
    if (path === "/api/v1/admin/laptops" && method === "POST") {
      return execute(
        "createAdminLaptop",
        parse(laptopMutationSchema, await jsonBody(request)),
        await privilegedAdmin(["OWNER", "OPERATIONS"]),
        requiredIdempotency(request),
      );
    }
    const adminLaptop = path.match(/^\/api\/v1\/admin\/laptops\/([^/]+)$/);
    if (adminLaptop && method === "PATCH") {
      return execute(
        "updateAdminLaptop",
        { laptopId: uuid(adminLaptop[1]!), ...parse(laptopMutationSchema, await jsonBody(request)) },
        await privilegedAdmin(["OWNER", "OPERATIONS"]),
        requiredIdempotency(request),
        requiredVersion(request),
      );
    }
    if (adminLaptop && method === "DELETE") {
      return execute(
        "retireAdminLaptop",
        { laptopId: uuid(adminLaptop[1]!) },
        await privilegedAdmin(["OWNER"]),
        requiredIdempotency(request),
        requiredVersion(request),
      );
    }
    const laptopStatus = path.match(/^\/api\/v1\/admin\/laptops\/([^/]+)\/status$/);
    if (laptopStatus && method === "POST") return execute("setAdminLaptopStatus", { laptopId: uuid(laptopStatus[1]!), ...parse(laptopStatusSchema, await jsonBody(request)) }, await privilegedAdmin(["OWNER", "OPERATIONS"]), requiredIdempotency(request), requiredVersion(request));
    const laptopImage = path.match(/^\/api\/v1\/admin\/laptops\/([^/]+)\/images$/);
    if (laptopImage && method === "POST") return execute("attachAdminLaptopImage", { laptopId: uuid(laptopImage[1]!), ...parse(laptopImageSchema, await jsonBody(request)) }, await privilegedAdmin(["OWNER", "OPERATIONS"]), requiredIdempotency(request), requiredVersion(request));
    const kycReview = path.match(/^\/api\/v1\/admin\/rentals\/([^/]+)\/kyc\/(verify|reject)$/);
    if (kycReview && method === "POST") {
      const verify = kycReview[2] === "verify";
      return execute(
        verify ? "verifyRentalKyc" : "rejectRentalKyc",
        {
          rentalId: uuid(kycReview[1]!),
          ...parse(verify ? verifyKycCommandSchema : rejectKycCommandSchema, await jsonBody(request)),
        },
        await privilegedAdmin(["OWNER", "REVIEWER"]),
        requiredIdempotency(request),
        requiredVersion(request),
      );
    }
    const paymentReview = path.match(/^\/api\/v1\/admin\/rentals\/([^/]+)\/payments\/([^/]+)\/(verify|reject)$/);
    if (paymentReview && method === "POST") {
      const verify = paymentReview[3] === "verify";
      return execute(
        verify ? "verifyRentalPayment" : "rejectRentalPayment",
        {
          rentalId: uuid(paymentReview[1]!),
          paymentId: uuid(paymentReview[2]!),
          ...parse(verify ? verifyPaymentCommandSchema : rejectPaymentCommandSchema, await jsonBody(request)),
        },
        await privilegedAdmin(["OWNER", "REVIEWER"]),
        requiredIdempotency(request),
        requiredVersion(request),
      );
    }
    const commandMatch = path.match(/^\/api\/v1\/admin\/rentals\/([^/]+)\/commands\/([^/]+)$/);
    if (commandMatch && method === "POST") {
      const command = parse(z.enum(commands), commandMatch[2]) as Command;
      const reviewerCommand = command === "approve" || command === "reject";
      const principal = await privilegedAdmin(reviewerCommand ? ["OWNER", "REVIEWER"] : ["OWNER", "OPERATIONS"], command === "complete-settlement" || command === "finalize-inspection");
      const body = parse(rentalCommandSchema, await jsonBody(request, true));
      if (["reject", "request-return", "finalize-inspection"].includes(command) && !body.reason) throw new ApiFailure("VALIDATION_ERROR", "reason is required for this command");
      if (command === "finalize-inspection" && !body.inspectionId) throw new ApiFailure("VALIDATION_ERROR", "inspectionId is required for inspection disposition");
      return execute(
        "executeRentalCommand",
        { rentalId: uuid(commandMatch[1]!), command, ...body },
        principal,
        requiredIdempotency(request),
        requiredVersion(request),
      );
    }
    const refunds = path.match(/^\/api\/v1\/admin\/rentals\/([^/]+)\/refunds$/);
    if (refunds && method === "POST") {
      return execute(
        "requestRentalRefund",
        { rentalId: uuid(refunds[1]!), ...parse(refundSchema, await jsonBody(request)) },
        await privilegedAdmin(["OWNER", "OPERATIONS"], true),
        requiredIdempotency(request),
      );
    }
    const financial = path.match(/^\/api\/v1\/admin\/rentals\/([^/]+)\/financial-summary$/);
    if (financial && method === "GET") return execute("getRentalFinancialSummary", { rentalId: uuid(financial[1]!) }, await privilegedAdmin(["OWNER", "OPERATIONS"]));
    const confirmRefund = path.match(/^\/api\/v1\/admin\/rentals\/([^/]+)\/refunds\/([^/]+)\/confirm$/);
    if (confirmRefund && method === "POST") return execute("confirmRentalRefund", { rentalId: uuid(confirmRefund[1]!), refundId: uuid(confirmRefund[2]!), ...parse(refundConfirmationSchema, await jsonBody(request)) }, await privilegedAdmin(["OWNER", "OPERATIONS"], true), requiredIdempotency(request), requiredVersion(request));
    const inspections = path.match(/^\/api\/v1\/admin\/rentals\/([^/]+)\/inspections$/);
    if (inspections && method === "GET") {
      return execute("listRentalInspections", { rentalId: uuid(inspections[1]!) }, await privilegedAdmin(["OWNER", "OPERATIONS"]));
    }
    if (inspections && method === "POST") {
      return execute(
        "createRentalInspection",
        { rentalId: uuid(inspections[1]!), ...parse(inspectionSchema, await jsonBody(request)) },
        await privilegedAdmin(["OWNER", "OPERATIONS"]),
        requiredIdempotency(request),
      );
    }
    const fees = path.match(/^\/api\/v1\/admin\/rentals\/([^/]+)\/fee-obligations$/);
    if (fees && method === "POST") {
      return execute(
        "createRentalFeeObligation",
        { rentalId: uuid(fees[1]!), ...parse(feeSchema, await jsonBody(request)) },
        await privilegedAdmin(["OWNER", "OPERATIONS"], true),
        requiredIdempotency(request),
      );
    }
    const history = path.match(/^\/api\/v1\/admin\/rentals\/([^/]+)\/history$/);
    if (history && method === "GET") {
      return execute(
        "listAdminRentalHistory",
        { rentalId: uuid(history[1]!), ...parse(paginationSchema, queryObject(url)) },
        await anyAdmin(),
      );
    }
    const signedRead = path.match(/^\/api\/v1\/admin\/evidence\/([^/]+)\/signed-read$/);
    if (signedRead && method === "POST") {
      return execute(
        "createEvidenceSignedRead",
        { evidenceId: uuid(signedRead[1]!) },
        await privilegedAdmin(["OWNER", "OPERATIONS", "REVIEWER"]),
      );
    }
    if (path === "/api/v1/admin/settings" && method === "GET") {
      return execute("listAdminSettings", {}, await anyAdmin());
    }
    if (path === "/api/v1/admin/settings" && method === "PATCH") {
      return execute(
        "updateAdminSettings",
        parse(settingSchema, await jsonBody(request)),
        await privilegedAdmin(["OWNER"], true),
        requiredIdempotency(request),
        requiredVersion(request),
      );
    }
    if (path === "/api/v1/admin/contracts" && method === "POST") {
      return execute(
        "publishAdminContract",
        parse(contractPublishSchema, await jsonBody(request)),
        await privilegedAdmin(["OWNER"], true),
        requiredIdempotency(request),
      );
    }
    if (path === "/api/v1/admin/audit-events" && method === "GET") {
      return execute("listAdminAuditEvents", parse(auditQuerySchema, queryObject(url)), await anyAdmin());
    }

    throw new ApiFailure("NOT_FOUND", "API route not found");
  } catch (error) {
    if (error instanceof ApiFailure) return errorResponse(error, requestId);
    if (error instanceof OperationUnavailable) {
      return errorResponse(new ApiFailure("INTERNAL_ERROR", "Required persistence capability is unavailable"), requestId);
    }
    return errorResponse(new ApiFailure("INTERNAL_ERROR", "Unexpected server error"), requestId);
  }
}

export function handleRuntimeApiRequest(request: Request): Promise<Response> {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL;
  return handleApiRequest(request, {
    operations: runtimeOperations,
    trustedOrigins: new Set(configuredOrigin ? [configuredOrigin] : []),
    rateLimiter: runtimeRateLimiter,
  });
}

const runtimeOperations = runtimeSupabaseOperations();
// ponytail: per-instance limiter bounds abuse locally; replace with a shared store when multi-instance enforcement is required.
const runtimeRateLimiter = createMemoryRateLimiter();
