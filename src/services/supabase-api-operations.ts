import type { AdminRole } from "@/types/domain";

import { requestHash } from "../domain/idempotency";
import { ApiFailure } from "../lib/server/api-errors";
import { completeAdminOAuth, handleAdminMfa, startAdminOAuth, type AdminOAuthConfig } from "../lib/server/admin-oauth";
import {
  adminCsrfToken,
  decodeJwtPayload,
  opaqueToken,
  secureRandomUuid,
  sha256,
  signJwt,
  type JwtClaims,
} from "../lib/server/security";
import type {
  AdminPrincipal,
  ApiOperation,
  ApiOperations,
  CustomerPrincipal,
  OperationContext,
  OperationResult,
  Principal,
} from "./api-operations";
import { OperationUnavailable } from "./api-operations";

type Fetch = typeof fetch;

export type SupabaseApiConfig = {
  supabaseUrl: string | undefined;
  publishableKey: string | undefined;
  appUrl: string | undefined;
  lineChannelId: string | undefined;
  sessionSecret: string | undefined;
  jwtPrivateKey: string | undefined;
  jwtKeyId: string | undefined;
  jwtIssuer: string | undefined;
  jwtAudience: string | undefined;
  allowBasicUploadScan: boolean;
  adminOAuthProvider?: string | undefined;
};

export type SupabaseApiDependencies = {
  fetch: Fetch;
  now: () => Date;
  token: (bytes?: number) => string;
  uuid: () => string;
  jwt: typeof signJwt;
};

type JsonObject = Record<string, unknown>;

const defaultDependencies: SupabaseApiDependencies = {
  fetch,
  now: () => new Date(),
  token: opaqueToken,
  uuid: secureRandomUuid,
  jwt: signJwt,
};

const permissions: Record<AdminRole, readonly string[]> = {
  OWNER: ["rental:read", "audit:read", "evidence:review", "rental:review", "inventory:write", "inspection:write", "finance:write", "settings:write"],
  OPERATIONS: ["rental:read", "audit:read", "inventory:write", "inspection:write", "finance:write"],
  REVIEWER: ["rental:read", "audit:read", "evidence:review", "rental:review"],
  VIEWER: ["rental:read", "audit:read"],
};

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OperationUnavailable("Malformed database response");
  return value as JsonObject;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new OperationUnavailable("Malformed database response");
  return value;
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new OperationUnavailable("Malformed database response");
  return value;
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new OperationUnavailable("Malformed database response");
  return value;
}

function encodeCursor(value: string | number): string {
  return Buffer.from(JSON.stringify({ value })).toString("base64url");
}

function decodeCursor(value: unknown): string | number | null {
  if (!value) return null;
  try {
    const decoded = object(JSON.parse(Buffer.from(string(value), "base64url").toString("utf8")));
    return typeof decoded.value === "string" || typeof decoded.value === "number" ? decoded.value : null;
  } catch {
    throw new ApiFailure("VALIDATION_ERROR", "Invalid cursor");
  }
}

function parseVersion(value: string | undefined): number {
  const normalized = value?.replace(/^W\//, "").replace(/^"|"$/g, "").replace(/^v/i, "");
  const version = Number(normalized);
  if (!Number.isInteger(version) || version < 0) throw new ApiFailure("VALIDATION_ERROR", "If-Match must contain a resource version");
  return version;
}

function databaseFailure(status: number, payload: unknown): ApiFailure {
  const error = payload && typeof payload === "object" ? payload as JsonObject : {};
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message : "";
  const marker = message.toUpperCase();
  if (marker.includes("IDEMPOTENCY_CONFLICT")) return new ApiFailure("IDEMPOTENCY_CONFLICT", "Idempotency key conflicts with the original request");
  if (marker.includes("INVALID_TRANSITION")) return new ApiFailure("INVALID_TRANSITION", "The requested transition is not allowed");
  if (marker.includes("UPLOAD_REJECTED")) return new ApiFailure("UPLOAD_REJECTED", "The uploaded object was rejected");
  if (marker.includes("AUTH_REQUIRED")) return new ApiFailure("AUTH_REQUIRED", "A valid session is required");
  if (marker.includes("FORBIDDEN") || marker.includes("RECENT_MFA_REQUIRED")) return new ApiFailure("FORBIDDEN", "The current principal is not permitted");
  if (marker.includes("NOT_FOUND") || code === "P0002" || status === 404) return new ApiFailure("NOT_FOUND", "Resource not found");
  if (code === "23P01" || code === "23505" || status === 409) return new ApiFailure("CONFLICT", "The request conflicts with current state");
  if (code === "22023" || code === "23514" || status === 400) return new ApiFailure("VALIDATION_ERROR", "Request validation failed");
  if (status === 401) return new ApiFailure("AUTH_REQUIRED", "A valid session is required");
  if (status === 403 || code === "42501") return new ApiFailure("FORBIDDEN", "The current principal is not permitted");
  return new ApiFailure("INTERNAL_ERROR", "Database operation failed");
}

function cookie(name: string, value: string, maxAge: number, secure: boolean, httpOnly: boolean, path = "/"): string {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=${path}; SameSite=Lax${secure ? "; Secure" : ""}${httpOnly ? "; HttpOnly" : ""}`;
}

function clearCookie(name: string, secure: boolean, httpOnly: boolean, path = "/"): string {
  return cookie(name, "", 0, secure, httpOnly, path);
}

function storagePath(bucket: string, key: string): string {
  return `${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function detectMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

async function readBounded(response: Response, maximum: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximum) throw new ApiFailure("UPLOAD_REJECTED", "The uploaded object is too large");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new ApiFailure("UPLOAD_REJECTED", "The uploaded object is too large");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export class SupabaseApiOperations implements ApiOperations {
  constructor(
    private readonly config: SupabaseApiConfig,
    private readonly dependencies: SupabaseApiDependencies = defaultDependencies,
  ) {}

  private value(key: Exclude<keyof SupabaseApiConfig, "allowBasicUploadScan">): string {
    const value = this.config[key];
    if (!value) throw new OperationUnavailable(`Missing runtime configuration: ${key}`);
    return value;
  }

  private secureCookies(): boolean {
    return Boolean(this.config.appUrl?.startsWith("https://"));
  }

  private serviceJwt(role: "app_session_service" | "app_outbox_worker" | "app_upload_scanner" | "app_line_webhook_ingress" | "app_line_webhook_worker", scope: string, lifetime: number, stableSubject?: string): string {
    const privateKey = this.value("jwtPrivateKey");
    const keyId = this.value("jwtKeyId");
    const issued = Math.floor(this.dependencies.now().getTime() / 1000);
    const principal = { app_session_service: "session_service", app_outbox_worker: "service_worker", app_upload_scanner: "upload_scanner", app_line_webhook_ingress: "line_webhook_ingress", app_line_webhook_worker: "line_webhook_worker" }[role];
    const claims: JwtClaims = {
      iss: this.value("jwtIssuer"),
      aud: this.value("jwtAudience"),
      role,
      sub: stableSubject ?? this.dependencies.uuid(),
      principal_type: principal,
      scope,
      jti: this.dependencies.uuid(),
      iat: issued,
      nbf: issued,
      exp: issued + lifetime,
    };
    return this.dependencies.jwt(claims, privateKey, keyId);
  }

  private customerJwt(customerId: string, sessionId: string): string {
    const privateKey = this.value("jwtPrivateKey");
    const keyId = this.value("jwtKeyId");
    const issued = Math.floor(this.dependencies.now().getTime() / 1000);
    return this.dependencies.jwt({
      iss: this.value("jwtIssuer"),
      aud: this.value("jwtAudience"),
      role: "authenticated",
      sub: customerId,
      principal_type: "customer",
      session_id: sessionId,
      jti: this.dependencies.uuid(),
      iat: issued,
      nbf: issued,
      exp: issued + 300,
    }, privateKey, keyId);
  }

  private async rpc(name: string, args: JsonObject, token?: string): Promise<unknown> {
    const url = this.value("supabaseUrl");
    const key = this.value("publishableKey");
    const response = await this.dependencies.fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: key,
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    let payload: unknown = null;
    try { payload = text ? JSON.parse(text) : null; } catch { /* mapped below */ }
    if (!response.ok) throw databaseFailure(response.status, payload);
    return payload;
  }

  private tokenFor(principal: Principal | null): string {
    if (!principal?.dbToken) throw new ApiFailure("AUTH_REQUIRED", "A valid database principal is required");
    return principal.dbToken;
  }

  private async storage(method: string, path: string, token: string, body?: unknown): Promise<unknown> {
    const url = this.value("supabaseUrl");
    const key = this.value("publishableKey");
    const response = await this.dependencies.fetch(`${url.replace(/\/$/, "")}/storage/v1/${path}`, {
      method,
      headers: {
        apikey: key,
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let payload: unknown = null;
    try { payload = text ? JSON.parse(text) : null; } catch { /* mapped below */ }
    if (!response.ok) throw databaseFailure(response.status, payload);
    return payload;
  }

  private page(itemsValue: unknown, limit: number, requestId: string): JsonObject {
    const all = array(itemsValue);
    const hasMore = all.length > limit;
    const data = all.slice(0, limit);
    const last = data.at(-1);
    const id = last && typeof last === "object" ? (last as JsonObject).id : null;
    return {
      data,
      page: { nextCursor: hasMore && (typeof id === "string" || typeof id === "number") ? encodeCursor(id) : null, hasMore },
      meta: { requestId, generatedAt: this.dependencies.now().toISOString() },
    };
  }

  private laptopAssets(value: unknown): unknown {
    const item = object(value);
    return {
      ...item,
      thumbnailUrl: this.storageAssetUrl(item.thumbnailUrl),
      ...(Array.isArray(item.imageUrls) ? { imageUrls: item.imageUrls.map((candidate) => this.storageAssetUrl(candidate)) } : {}),
    };
  }

  private storageAssetUrl(candidate: unknown): string {
    try {
      if (typeof candidate === "string" && candidate) {
        const resolved = new URL(candidate, this.value("supabaseUrl"));
        if (["https:", "http:"].includes(resolved.protocol) && !resolved.username && !resolved.password) return resolved.toString();
      }
    } catch { /* Malformed legacy asset paths fall back to an empty product placeholder. */ }
    return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='400'/%3E";
  }

  async resolveSession(kind: Principal["kind"], token: string): Promise<Principal | null> {
    if (kind === "customer") {
      const scoped = this.serviceJwt("app_session_service", "session:resolve", 60);
      const result = object(await this.rpc("app_resolve_session", { p_session_token_hash: sha256(token) }, scoped));
      if (result.valid !== true) return null;
      const customerId = string(result.customerId);
      const sessionId = string(result.sessionId);
      return {
        kind: "customer",
        id: customerId,
        dbToken: this.customerJwt(customerId, sessionId),
        csrfHash: string(result.csrfHash),
        sessionTokenHash: sha256(token),
      } satisfies CustomerPrincipal;
    }

    try {
      const result = object(await this.rpc("get_admin_session", {}, token));
      const roles = array(result.roles).filter((role): role is AdminRole => typeof role === "string" && ["OWNER", "OPERATIONS", "REVIEWER", "VIEWER"].includes(role));
      const payload = decodeJwtPayload(token);
      const expiresAt = typeof payload?.exp === "number" ? new Date(payload.exp * 1000).toISOString() : null;
      if (!roles.length || !expiresAt) return null;
      const id = string(result.id);
      return {
        kind: "admin",
        id,
        roles,
        mfaVerified: result.mfaVerified === true,
        ...(typeof result.mfaVerifiedAt === "string" ? { mfaVerifiedAt: result.mfaVerifiedAt } : {}),
        dbToken: token,
        ...(this.config.sessionSecret ? { csrfToken: adminCsrfToken(this.config.sessionSecret, id, token) } : {}),
      } satisfies AdminPrincipal;
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "AUTH_REQUIRED") return null;
      throw error;
    }
  }

  private async lineIdentity(accessToken: string): Promise<{ subject: string; displayName: string | null }> {
    try {
      const channelId = this.value("lineChannelId");
      const verified = await this.dependencies.fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      const verifiedPayload = verified.ok ? object(await verified.json()) : null;
      if (!verifiedPayload || verifiedPayload.client_id !== channelId || number(verifiedPayload.expires_in) <= 0) {
        throw new ApiFailure("AUTH_REQUIRED", "LINE credential is invalid");
      }
      const profile = await this.dependencies.fetch("https://api.line.me/v2/profile", {
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!profile.ok) throw new ApiFailure("AUTH_REQUIRED", "LINE credential is invalid");
      const payload = object(await profile.json());
      return {
        subject: string(payload.userId),
        displayName: typeof payload.displayName === "string" ? payload.displayName.slice(0, 120) : null,
      };
    } catch (error) {
      if (error instanceof OperationUnavailable && error.message.startsWith("Missing runtime configuration")) throw error;
      throw new ApiFailure("AUTH_REQUIRED", "LINE credential is invalid");
    }
  }

  private async issueBootstrap(): Promise<OperationResult> {
    const nonce = this.dependencies.token(32);
    const binding = this.dependencies.token(32);
    const expiresAt = new Date(this.dependencies.now().getTime() + 5 * 60_000);
    await this.rpc("app_issue_line_bootstrap_nonce", {
      p_nonce_hash: sha256(nonce),
      p_browser_binding_hash: sha256(binding),
      p_expires_at: expiresAt.toISOString(),
    }, this.serviceJwt("app_session_service", "session:bootstrap", 60));
    const headers = new Headers();
    headers.append("Set-Cookie", cookie("nr_line_bootstrap", binding, 300, this.secureCookies(), true, "/api/v1/auth/line"));
    return { status: 201, body: { nonce, expiresAt: expiresAt.toISOString() }, headers };
  }

  private async createLineSession(input: JsonObject): Promise<OperationResult> {
    if (typeof input.browserBinding !== "string") throw new ApiFailure("AUTH_REQUIRED", "LINE bootstrap is invalid or expired");
    const binding = input.browserBinding;
    const identity = await this.lineIdentity(string(input.accessToken));
    const sessionToken = this.dependencies.token(32);
    const csrfToken = this.dependencies.token(32);
    const now = this.dependencies.now();
    await this.rpc("app_create_line_session", {
      p_nonce_hash: sha256(string(input.nonce)),
      p_browser_binding_hash: sha256(binding),
      p_line_subject: identity.subject,
      p_session_token_hash: sha256(sessionToken),
      p_csrf_hash: sha256(csrfToken),
      p_display_name: identity.displayName,
      p_idle_expires_at: new Date(now.getTime() + 30 * 60_000).toISOString(),
      p_absolute_expires_at: new Date(now.getTime() + 12 * 60 * 60_000).toISOString(),
    }, this.serviceJwt("app_session_service", "session:bootstrap", 60));
    const headers = new Headers();
    headers.append("Set-Cookie", cookie("nr_customer_session", sessionToken, 43_200, this.secureCookies(), true));
    headers.append("Set-Cookie", cookie("nr_csrf", csrfToken, 43_200, this.secureCookies(), false));
    headers.append("Set-Cookie", clearCookie("nr_line_bootstrap", this.secureCookies(), true, "/api/v1/auth/line"));
    return { status: 204, headers };
  }

  private async revoke(principal: Principal): Promise<OperationResult> {
    const headers = new Headers();
    if (principal.kind === "customer") {
      if (!principal.sessionTokenHash) throw new ApiFailure("AUTH_REQUIRED", "A valid session is required");
      await this.rpc("app_revoke_session", { p_session_token_hash: principal.sessionTokenHash }, this.serviceJwt("app_session_service", "session:revoke", 60));
      headers.append("Set-Cookie", clearCookie("nr_customer_session", this.secureCookies(), true));
      headers.append("Set-Cookie", clearCookie("nr_csrf", this.secureCookies(), false));
    } else {
      const url = this.value("supabaseUrl");
      const key = this.value("publishableKey");
      const response = await this.dependencies.fetch(`${url.replace(/\/$/, "")}/auth/v1/logout`, {
        method: "POST",
        headers: { apikey: key, authorization: `Bearer ${this.tokenFor(principal)}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw databaseFailure(response.status, await response.json().catch(() => null));
      headers.append("Set-Cookie", clearCookie("nr_admin_session", this.secureCookies(), true));
      headers.append("Set-Cookie", clearCookie("nr_admin_csrf", this.secureCookies(), false));
    }
    return { status: 204, headers };
  }

  private async uploadIntent(input: JsonObject, principal: Principal): Promise<OperationResult> {
    const token = this.tokenFor(principal);
    const record = object(await this.rpc("create_upload_intent_record", {
      p_purpose: input.purpose,
      p_target_id: input.targetId,
      p_filename: input.filename,
      p_mime_type: input.mimeType,
      p_size_bytes: input.sizeBytes,
    }, token));
    const bucket = string(record.bucketId);
    const key = string(record.objectKey);
    const signed = object(await this.storage("POST", `object/upload/sign/${storagePath(bucket, key)}`, token, {}));
    const signedPath = typeof signed.url === "string" ? signed.url : typeof signed.signedURL === "string" ? signed.signedURL : signed.signedUrl;
    if (typeof signedPath !== "string") throw new OperationUnavailable("Storage did not return a signed upload path");
    const base = this.value("supabaseUrl").replace(/\/$/, "");
    return { status: 201, body: {
      uploadId: record.uploadId,
      method: "PUT",
      uploadUrl: signedPath.startsWith("http") ? signedPath : `${base}/storage/v1${signedPath.startsWith("/") ? "" : "/"}${signedPath}`,
      headers: {},
      expiresAt: record.expiresAt,
    } };
  }

  private scannerSubject(): string {
    const hash = sha256(`${this.config.jwtIssuer ?? "scanner"}:${this.config.jwtKeyId ?? "current"}`);
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  }

  private async finalizeUpload(input: JsonObject, context: OperationContext): Promise<OperationResult> {
    if (!this.config.allowBasicUploadScan) throw new OperationUnavailable("An approved production malware scanner is required");
    const ownerToken = this.tokenFor(context.principal);
    const uploadId = string(input.uploadId);
    const authorization = object(await this.rpc("authorize_upload_scan", { p_upload_id: uploadId }, ownerToken));
    const scannerToken = this.serviceJwt("app_upload_scanner", "upload:scan", 300, this.scannerSubject());
    const url = this.value("supabaseUrl");
    const key = this.value("publishableKey");
    const response = await this.dependencies.fetch(
      `${url.replace(/\/$/, "")}/storage/v1/object/authenticated/${storagePath(string(authorization.bucketId), string(authorization.objectKey))}`,
      { headers: { apikey: key, authorization: `Bearer ${scannerToken}` }, signal: AbortSignal.timeout(20_000) },
    );
    if (!response.ok) throw databaseFailure(response.status, await response.json().catch(() => null));
    const expectedSize = number(authorization.sizeBytes);
    const bytes = await readBounded(response, 10_485_760);
    const mime = detectMime(bytes);
    if (!mime || mime !== authorization.declaredMimeType || bytes.byteLength !== expectedSize) {
      throw new ApiFailure("UPLOAD_REJECTED", "The uploaded object does not match its declaration");
    }
    const body = object(await this.rpc("finalize_upload_intent_record", {
      p_upload_id: uploadId,
      p_detected_mime_type: mime,
      p_detected_size_bytes: bytes.byteLength,
      p_content_sha256: sha256(bytes),
      p_scan_result: "CLEAN",
      p_idempotency_key: context.idempotencyKey,
      p_request_hash: requestHash({ uploadId }),
      p_request_id: context.requestId,
    }, scannerToken));
    return { status: 201, body };
  }

  private async signedRead(input: JsonObject, principal: Principal): Promise<OperationResult> {
    const token = this.tokenFor(principal);
    const target = object(await this.rpc("authorize_evidence_read", { p_evidence_id: input.evidenceId }, token));
    const signed = object(await this.storage("POST", `object/sign/${storagePath(string(target.bucketId), string(target.objectKey))}`, token, { expiresIn: 60 }));
    const signedPath = typeof signed.signedURL === "string" ? signed.signedURL : typeof signed.signedUrl === "string" ? signed.signedUrl : signed.url;
    if (typeof signedPath !== "string") throw new OperationUnavailable("Storage did not return a signed read path");
    const base = this.value("supabaseUrl").replace(/\/$/, "");
    return { status: 200, body: {
      readUrl: signedPath.startsWith("http") ? signedPath : `${base}/storage/v1${signedPath.startsWith("/") ? "" : "/"}${signedPath}`,
      expiresAt: new Date(this.dependencies.now().getTime() + 60_000).toISOString(),
    } };
  }

  async execute(operation: ApiOperation, inputValue: unknown, context: OperationContext): Promise<OperationResult> {
    const input = object(inputValue);
    if (operation === "startAdminLogin") {
      try { return startAdminOAuth(this.adminOAuthConfig(), this.dependencies); }
      catch { return { status: 503, body: { error: { code: "INTERNAL_ERROR", message: "Admin authentication is unavailable", requestId: context.requestId } } }; }
    }
    if (operation === "completeAdminLogin") return completeAdminOAuth(input, this.adminOAuthConfig(), this.dependencies, (token) => this.resolveSession("admin", token));
    if (operation === "challengeAdminMfa" || operation === "verifyAdminMfa") {
      const result = await handleAdminMfa(operation === "challengeAdminMfa" ? "challenge" : "verify", input, this.adminOAuthConfig(), this.dependencies, (token) => this.resolveSession("admin", token));
      if (result.body) {
        const body = object(result.body);
        if (body.error) result.body = { error: { ...object(body.error), requestId: context.requestId } };
      }
      return result;
    }
    if (operation === "createLineBootstrap") return this.issueBootstrap();
    if (operation === "createLineSession") return this.createLineSession(input);
    if (operation === "deleteCurrentSession" || operation === "deleteAdminSession") {
      if (!context.principal) throw new ApiFailure("AUTH_REQUIRED", "A valid session is required");
      return this.revoke(context.principal);
    }

    const token = ["listLaptops", "getLaptop", "getCustomerPublicSettings"].includes(operation) ? undefined : this.tokenFor(context.principal);
    const idem = () => ({
      p_idempotency_key: context.idempotencyKey,
      p_request_hash: requestHash({ input, ifMatch: context.ifMatch ?? null }),
      p_request_id: context.requestId,
    });
    const version = () => parseVersion(context.ifMatch);

    switch (operation) {
      case "listLaptops": {
        const limit = number(input.limit);
        const data = await this.rpc("list_public_laptops", {
          p_start_date: input.startDate ?? null,
          p_end_date: input.endDate ?? null,
          p_limit: Math.min(limit + 1, 100),
          p_cursor: decodeCursor(input.cursor),
        });
        const page = this.page(data, limit, context.requestId);
        page.data = array(page.data).map((item) => this.laptopAssets(item));
        return { status: 200, body: page };
      }
      case "getLaptop": {
        const body = await this.rpc("get_public_laptop", { p_laptop_id: input.laptopId });
        if (body === null) throw new ApiFailure("NOT_FOUND", "Laptop not found");
        return { status: 200, body: this.laptopAssets(body) };
      }
      case "getCurrentContract": {
        const body = await this.rpc("get_current_contract", {}, token);
        if (body === null) throw new ApiFailure("NOT_FOUND", "Contract not found");
        return { status: 200, body };
      }
      case "getPaymentSettings": {
        const result = object(await this.rpc("get_payment_settings", {}, token));
        const value = typeof result.value === "string" ? object(JSON.parse(result.value)) : object(result.value);
        return { status: 200, body: { qrImageUrl: this.storageAssetUrl(value.qrImageUrl), accountDisplayName: string(value.accountDisplayName), updatedAt: result.updatedAt } };
      }
      case "getCustomerPublicSettings": {
        const result = object(await this.rpc("get_customer_public_settings", {}));
        let contactLineUrl: string | null = null;
        try {
          const url = new URL(string(result.contactLineUrl));
          if (url.protocol === "https:" && ["line.me", "lin.ee"].includes(url.hostname) && !url.username && !url.password) contactLineUrl = url.toString();
        } catch { /* Invalid or absent legacy settings are not exposed. */ }
        return { status: 200, body: { contactLineUrl } };
      }
      case "createQuote":
        return { status: 201, body: await this.rpc("create_rental_quote", { p_laptop_id: input.laptopId, p_start_date: input.startDate, p_end_date: input.endDate }, token) };
      case "listOwnRentals": {
        const limit = number(input.limit);
        return { status: 200, body: this.page(await this.rpc("list_own_rentals", { p_limit: Math.min(limit + 1, 100), p_cursor: decodeCursor(input.cursor) }, token), limit, context.requestId) };
      }
      case "createRental": {
        const customer = object(input.customer);
        return { status: 201, body: await this.rpc("create_rental_from_quote", {
          p_quote_id: input.quoteId, p_customer_name: customer.name, p_customer_phone: customer.phone, ...idem(),
        }, token) };
      }
      case "getOwnRental": {
        const body = await this.rpc("get_own_rental", { p_rental_id: input.rentalId }, token);
        if (body === null) throw new ApiFailure("NOT_FOUND", "Rental not found");
        return { status: 200, body };
      }
      case "acceptRentalContract":
        return { status: 201, body: await this.rpc("accept_rental_contract", {
          p_rental_id: input.rentalId, p_contract_version_id: input.contractVersionId,
          p_content_hash: input.contentHash, p_ip_hash: null, p_user_agent_hash: context.userAgentHash ?? null, ...idem(),
        }, token) };
      case "submitRentalPayment":
        return { status: 201, body: await this.rpc("submit_rental_payment", {
          p_rental_id: input.rentalId, p_evidence_id: input.evidenceId, p_payment_type: input.type, ...idem(),
        }, token) };
      case "createUploadIntent":
        return this.uploadIntent(input, context.principal!);
      case "finalizeUpload":
        return this.finalizeUpload(input, context);
      case "getAdminSession": {
        const principal = context.principal as AdminPrincipal;
        const headers = new Headers();
        if (!principal.csrfToken) throw new OperationUnavailable("Admin CSRF signing is not configured");
        headers.append("Set-Cookie", cookie("nr_admin_csrf", principal.csrfToken, 28_800, this.secureCookies(), false));
        const expires = decodeJwtPayload(this.tokenFor(principal))?.exp;
        return { status: 200, headers, body: {
          adminId: principal.id,
          roles: principal.roles,
          mfaVerified: principal.mfaVerified,
          permissions: [...new Set(principal.roles.flatMap((role) => permissions[role]))],
          expiresAt: typeof expires === "number" ? new Date(expires * 1000).toISOString() : this.dependencies.now().toISOString(),
        } };
      }
      case "listAdminRentals":
        return { status: 200, body: await this.rpc("list_admin_rentals", { p_status: input.status ?? null, p_limit: input.limit, p_cursor: decodeCursor(input.cursor) }, token) };
      case "getAdminRental": {
        const body = await this.rpc("get_admin_rental", { p_rental_id: input.rentalId }, token);
        if (body === null) throw new ApiFailure("NOT_FOUND", "Rental not found");
        return { status: 200, body };
      }
      case "listAdminLaptops":
        return { status: 200, body: await this.rpc("list_admin_laptops", { p_include_retired: input.includeRetired, p_limit: input.limit, p_cursor: decodeCursor(input.cursor) }, token) };
      case "verifyRentalKyc":
      case "rejectRentalKyc":
        return { status: 200, body: await this.rpc(operation === "verifyRentalKyc" ? "verify_rental_kyc" : "reject_rental_kyc", {
          p_rental_id: input.rentalId, p_evidence_ids: input.evidenceIds, p_reason: input.reason ?? null,
          p_expected_version: version(), ...idem(),
        }, token) };
      case "verifyRentalPayment":
      case "rejectRentalPayment":
        return { status: 200, body: await this.rpc(operation === "verifyRentalPayment" ? "verify_rental_payment" : "reject_rental_payment", {
          p_rental_id: input.rentalId, p_payment_id: input.paymentId,
          ...(operation === "verifyRentalPayment" ? { p_provider_reference: input.providerReference } : {}),
          p_reason: input.reason, p_expected_version: version(), ...idem(),
        }, token) };
      case "createAdminLaptop":
        return { status: 201, body: await this.rpc("create_admin_laptop", {
          p_name: input.name, p_specs: input.specs, p_daily_rate_satang: input.dailyRateSatang,
          p_deposit_satang: input.depositSatang, ...idem(),
        }, token) };
      case "updateAdminLaptop":
        return { status: 200, body: await this.rpc("update_admin_laptop", {
          p_laptop_id: input.laptopId, p_name: input.name, p_specs: input.specs,
          p_daily_rate_satang: input.dailyRateSatang, p_deposit_satang: input.depositSatang,
          p_expected_version: version(), ...idem(),
        }, token) };
      case "retireAdminLaptop":
        await this.rpc("retire_admin_laptop", { p_laptop_id: input.laptopId, p_expected_version: version(), ...idem() }, token);
        return { status: 204 };
      case "setAdminLaptopStatus":
        return { status: 200, body: await this.rpc("set_admin_laptop_status", {
          p_laptop_id: input.laptopId, p_status: input.status, p_reason: input.reason, p_expected_version: version(), ...idem(),
        }, token) };
      case "attachAdminLaptopImage":
        return { status: 200, body: await this.rpc("attach_admin_laptop_image", {
          p_laptop_id: input.laptopId, p_evidence_id: input.evidenceId, p_alt_text: input.altText ?? "", p_expected_version: version(), ...idem(),
        }, token) };
      case "executeRentalCommand":
        return { status: 200, body: await this.rpc("execute_rental_command", {
          p_rental_id: input.rentalId, p_command: input.command, p_reason: input.reason ?? null,
          p_inspection_id: input.inspectionId ?? null, p_expected_version: version(), ...idem(),
        }, token) };
      case "requestRentalRefund":
        return { status: 202, body: await this.rpc("request_rental_refund", {
          p_rental_id: input.rentalId, p_amount_satang: input.amountSatang, p_reason: input.reason, ...idem(),
        }, token) };
      case "getRentalFinancialSummary":
        return { status: 200, body: await this.rpc("get_rental_financial_summary", { p_rental_id: input.rentalId }, token) };
      case "confirmRentalRefund":
        return { status: 200, body: await this.rpc("confirm_rental_refund", {
          p_rental_id: input.rentalId, p_refund_id: input.refundId, p_amount_satang: input.amountSatang,
          p_provider_reference: input.providerReference, p_reason: input.reason, p_expected_version: version(), ...idem(),
        }, token) };
      case "listRentalInspections":
        return { status: 200, body: await this.rpc("list_rental_inspections", { p_rental_id: input.rentalId }, token) };
      case "createRentalInspection":
        return { status: 201, body: await this.rpc("create_rental_inspection", {
          p_rental_id: input.rentalId, p_type: input.type, p_evidence_ids: input.evidenceIds, p_notes: input.notes, ...idem(),
        }, token) };
      case "createRentalFeeObligation":
        return { status: 201, body: await this.rpc("create_rental_fee_obligation", {
          p_rental_id: input.rentalId, p_type: input.type, p_amount_satang: input.amountSatang, p_reason: input.reason, ...idem(),
        }, token) };
      case "listAdminRentalHistory":
        return { status: 200, body: await this.rpc("list_admin_rental_history", {
          p_rental_id: input.rentalId, p_limit: input.limit, p_cursor: decodeCursor(input.cursor),
        }, token) };
      case "createEvidenceSignedRead":
        return this.signedRead(input, context.principal!);
      case "listAdminSettings":
        return { status: 200, body: await this.rpc("list_admin_settings", {}, token) };
      case "updateAdminSettings":
        return { status: 200, body: await this.rpc("update_admin_setting", {
          p_key: input.key, p_value: input.value, p_expected_version: version(), ...idem(),
        }, token) };
      case "publishAdminContract":
        return { status: 201, body: await this.rpc("publish_admin_contract", {
          p_title: input.title, p_content: input.content, p_effective_at: input.effectiveAt, ...idem(),
        }, token) };
      case "listAdminAuditEvents":
        return { status: 200, body: await this.rpc("list_admin_audit_events", {
          p_target_type: input.targetType ?? null, p_target_id: input.targetId ?? null,
          p_limit: input.limit, p_cursor: decodeCursor(input.cursor),
        }, token) };
    }
  }

  private adminOAuthConfig(): AdminOAuthConfig {
    return {
      appUrl: this.config.appUrl ?? "", supabaseUrl: this.config.supabaseUrl ?? "", publishableKey: this.config.publishableKey ?? "",
      provider: this.config.adminOAuthProvider ?? "", sessionSecret: this.config.sessionSecret ?? "",
    };
  }

  async persistLineWebhookReceipts(events: readonly LineReceiptMetadata[]): Promise<{ inserted: number; duplicates: number }> {
    const result = object(await this.rpc("persist_line_webhook_receipts", { p_events: events }, this.serviceJwt("app_line_webhook_ingress", "line:webhook:persist", 60)));
    return { inserted: number(result.inserted), duplicates: number(result.duplicates) };
  }

  async claimLineWebhookReceipts(limit = 20): Promise<unknown[]> {
    return array(await this.rpc("claim_line_webhook_receipts", { p_limit: limit }, this.serviceJwt("app_line_webhook_worker", "line:webhook:process", 300, this.scannerSubject())));
  }

  async completeLineWebhookReceipt(receiptId: string, leaseToken: string, outcome: "PROCESSED" | "IGNORED" | "FAILED", errorCategory?: string, retryAfterSeconds = 60): Promise<boolean> {
    return await this.rpc("complete_line_webhook_receipt", {
      p_receipt_id: receiptId, p_lease_token: leaseToken, p_outcome: outcome,
      p_error_category: errorCategory ?? null, p_retry_after_seconds: retryAfterSeconds,
    }, this.serviceJwt("app_line_webhook_worker", "line:webhook:process", 300, this.scannerSubject())) === true;
  }

  async claimOutbox(limit = 20): Promise<unknown[]> {
    const token = this.serviceJwt("app_outbox_worker", "notification:deliver", 300, this.scannerSubject());
    return array(await this.rpc("claim_notification_outbox", { p_limit: limit }, token)).map((value) => {
      const row = object(value);
      const recipient = row.recipient_line_user_id;
      if (recipient !== null && recipient !== undefined && typeof recipient !== "string") throw new OperationUnavailable("Malformed notification recipient");
      return { ...row, recipientLineUserId: typeof recipient === "string" ? recipient : null };
    });
  }

  async completeOutbox(eventId: string, leaseToken: string, delivered: boolean, errorCategory?: string, retryAfterSeconds = 60): Promise<boolean> {
    const token = this.serviceJwt("app_outbox_worker", "notification:deliver", 300, this.scannerSubject());
    return await this.rpc("complete_notification_outbox", {
      p_event_id: eventId, p_lease_token: leaseToken, p_delivered: delivered,
      p_error_category: errorCategory ?? null, p_retry_after_seconds: retryAfterSeconds,
    }, token) === true;
  }
}

export function runtimeSupabaseOperations(): SupabaseApiOperations {
  return new SupabaseApiOperations({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    lineChannelId: process.env.LINE_CHANNEL_ID,
    sessionSecret: process.env.SESSION_SIGNING_SECRET,
    jwtPrivateKey: process.env.CUSTOMER_DB_JWT_PRIVATE_KEY,
    jwtKeyId: process.env.CUSTOMER_DB_JWT_KEY_ID,
    jwtIssuer: process.env.CUSTOMER_DB_JWT_ISSUER,
    jwtAudience: process.env.CUSTOMER_DB_JWT_AUDIENCE,
    allowBasicUploadScan: process.env.NODE_ENV !== "production",
    adminOAuthProvider: process.env.SUPABASE_AUTH_PROVIDER,
  });
}

export type LineReceiptMetadata = { providerEventId: string; eventType: string; occurredAt?: string; payloadHash: string };
