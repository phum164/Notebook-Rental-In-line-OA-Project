import type { AdminRole, LaptopStatus, PaymentStatus, RentalStatus } from "@/types/domain";
import type { AdminContext, AdminLaptop, AdminPermission, AdminRental, AdminSetting, AuditEvent, FinancialSummary, InspectionSummary, LaptopInput, RentalCommand } from "./types";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type MutationOptions = { version?: number; idempotencyKey?: string | undefined; retryUnavailable?: boolean };
export type ConditionPurpose = "CONDITION_BEFORE" | "CONDITION_AFTER";
export const CONDITION_IMAGE_LIMIT = 12;
const roles = new Set<AdminRole>(["OWNER", "OPERATIONS", "REVIEWER", "VIEWER"]);
const statuses = new Set<RentalStatus>(["DRAFT", "PENDING_PAYMENT", "PENDING_REVIEW", "APPROVED", "PREPARING", "READY_FOR_HANDOVER", "ACTIVE", "RETURN_PENDING", "INSPECTION_PENDING", "REFUND_PENDING", "COMPLETED", "REJECTED", "CANCELLED", "EXPIRED"]);
const laptopStatuses = new Set<LaptopStatus>(["AVAILABLE", "RESERVED", "RENTED", "MAINTENANCE", "RETIRED"]);
const commands = new Set<RentalCommand>(["approve", "reject", "start-preparation", "mark-ready", "handover", "request-return", "receive-return", "finalize-inspection", "complete-settlement"]);

export class AdminApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly requestId?: string) { super(message); }
}

export class AdminApi {
  constructor(private readonly fetcher: FetchLike = fetch, private readonly csrfToken: () => string | null = readCsrfToken, private readonly idFactory: () => string = () => crypto.randomUUID()) {}

  getContext(): Promise<AdminContext> { return this.get("/admin/auth/session", parseContext); }
  async startMfaChallenge(): Promise<{ challengeId: string; expiresAt: string }> {
    const value = object(await this.mfaRequest("challenge", {}));
    return { challengeId: string(value.challengeId), expiresAt: string(value.expiresAt) };
  }
  async verifyMfa(challengeId: string, code: string): Promise<void> {
    if (!/^\d{6}$/.test(code)) throw new AdminApiError("VALIDATION_ERROR", "กรอกรหัสยืนยัน 6 หลัก");
    await this.mfaRequest("verify", { challengeId, code });
  }
  logout(): Promise<void> { return this.mutate("/admin/auth/session", "DELETE", undefined, {}, () => undefined); }
  listLaptops(includeRetired = false): Promise<AdminLaptop[]> { return this.get(`/admin/laptops?limit=100&includeRetired=${includeRetired}`, (v) => array(v).map(parseLaptop)); }
  createLaptop(input: LaptopInput, key?: string): Promise<AdminLaptop> { return this.mutate("/admin/laptops", "POST", input, { idempotencyKey: key }, parseLaptop); }
  updateLaptop(id: string, input: LaptopInput, version: number, key?: string): Promise<AdminLaptop> { return this.mutate(`/admin/laptops/${encodeURIComponent(id)}`, "PATCH", input, { version, idempotencyKey: key }, parseLaptop); }
  setLaptopStatus(id: string, status: "AVAILABLE" | "MAINTENANCE", reason: string, version: number): Promise<AdminLaptop> { return this.mutate(`/admin/laptops/${encodeURIComponent(id)}/status`, "POST", { status, reason }, { version }, parseLaptop); }
  attachLaptopImage(id: string, evidenceId: string, altText: string, version: number): Promise<AdminLaptop> { return this.mutate(`/admin/laptops/${encodeURIComponent(id)}/images`, "POST", { evidenceId, altText }, { version }, parseLaptop); }
  retireLaptop(id: string, version: number, key?: string): Promise<void> { return this.mutate(`/admin/laptops/${encodeURIComponent(id)}`, "DELETE", undefined, { version, idempotencyKey: key }, () => undefined); }
  listRentals(status?: RentalStatus): Promise<AdminRental[]> { const query = new URLSearchParams({ limit: "100" }); if (status) query.set("status", status); return this.get(`/admin/rentals?${query}`, (v) => array(v).map(parseRental)); }
  getRental(id: string): Promise<AdminRental> { return this.get(`/admin/rentals/${encodeURIComponent(id)}`, parseRental); }
  command(id: string, command: RentalCommand, version: number, body: { reason?: string; inspectionId?: string } = {}, key?: string): Promise<AdminRental> { return this.mutate(`/admin/rentals/${encodeURIComponent(id)}/commands/${command}`, "POST", body, { version, idempotencyKey: key }, parseRental); }
  reviewKyc(id: string, decision: "verify" | "reject", evidenceIds: string[], version: number, reason?: string, key?: string): Promise<AdminRental> { return this.mutate(`/admin/rentals/${encodeURIComponent(id)}/kyc/${decision}`, "POST", { evidenceIds, ...(reason ? { reason } : {}) }, { version, idempotencyKey: key }, parseRental); }
  reviewPayment(id: string, paymentId: string, decision: "verify" | "reject", version: number, input: { reason: string; providerReference?: string }, key?: string): Promise<AdminRental> { return this.mutate(`/admin/rentals/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}/${decision}`, "POST", input, { version, idempotencyKey: key }, parseRental); }
  listInspections(id: string): Promise<InspectionSummary[]> { return this.get(`/admin/rentals/${encodeURIComponent(id)}/inspections`, (v) => array(v).map(parseInspection)); }
  createInspection(id: string, input: { type: "BEFORE_RENT" | "AFTER_RETURN"; evidenceIds: string[]; notes: string }, key?: string): Promise<InspectionSummary> { return this.mutate(`/admin/rentals/${encodeURIComponent(id)}/inspections`, "POST", input, { idempotencyKey: key }, parseInspection); }
  uploadConditionEvidence(rentalId: string, purpose: ConditionPurpose, file: File): Promise<string> { return this.uploadImage(rentalId, purpose, file); }
  uploadProductEvidence(laptopId: string, file: File): Promise<string> { return this.uploadImage(laptopId, "LAPTOP_PRODUCT", file); }
  private async uploadImage(targetId: string, purpose: ConditionPurpose | "LAPTOP_PRODUCT", file: File): Promise<string> {
    validateConditionImages([file]);
    const intent = object(await this.mutate("/uploads/intents", "POST", {
      purpose, targetId, filename: file.name, mimeType: file.type, sizeBytes: file.size,
    }, { retryUnavailable: false }, (value) => value));
    const uploadId = string(intent.uploadId);
    const uploadUrl = string(intent.uploadUrl);
    const address = new URL(uploadUrl);
    if (intent.method !== "PUT" || !["https:", "http:"].includes(address.protocol) || address.username || address.password) {
      throw new AdminApiError("UPLOAD_REJECTED", "ลิงก์อัปโหลดไม่ถูกต้อง กรุณาลองอีกครั้ง");
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(object(intent.headers))) headers.set(name, string(value));
    if (!headers.has("content-type")) headers.set("content-type", file.type);
    let uploaded: Response;
    try {
      uploaded = await this.fetcher(uploadUrl, {
        method: "PUT", body: file, headers, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store",
      });
    } catch { throw new AdminApiError("UPLOAD_REJECTED", "อัปโหลดรูปไม่สำเร็จ กรุณาลองอีกครั้ง"); }
    if (!uploaded.ok) throw new AdminApiError("UPLOAD_REJECTED", "อัปโหลดรูปไม่สำเร็จ กรุณาลองอีกครั้ง");
    const evidence = object(await this.mutate(`/uploads/${encodeURIComponent(uploadId)}/finalize`, "POST", {}, {}, (value) => value));
    if (evidence.status !== "READY") throw new AdminApiError("UPLOAD_REJECTED", "รูปยังไม่ผ่านการตรวจสอบ กรุณาเลือกรูปใหม่หรือติดต่อผู้ดูแล");
    return string(evidence.evidenceId);
  }
  createFee(id: string, input: { type: "LATE_FEE" | "DAMAGE_FEE"; amountSatang: number; reason: string }, key?: string): Promise<unknown> { return this.mutate(`/admin/rentals/${encodeURIComponent(id)}/fee-obligations`, "POST", input, { idempotencyKey: key }, (v) => v); }
  requestRefund(id: string, input: { amountSatang: number; reason: string }, key?: string): Promise<unknown> { return this.mutate(`/admin/rentals/${encodeURIComponent(id)}/refunds`, "POST", input, { idempotencyKey: key }, (v) => v); }
  getFinancialSummary(id: string): Promise<FinancialSummary> { return this.get(`/admin/rentals/${encodeURIComponent(id)}/financial-summary`, parseFinancialSummary); }
  confirmRefund(id: string, refundId: string, input: { amountSatang: number; providerReference: string; reason: string }, version: number): Promise<FinancialSummary> { return this.mutate(`/admin/rentals/${encodeURIComponent(id)}/refunds/${encodeURIComponent(refundId)}/confirm`, "POST", input, { version }, parseFinancialSummary); }
  signedRead(evidenceId: string): Promise<{ readUrl: string; expiresAt: string }> { return this.mutate(`/admin/evidence/${encodeURIComponent(evidenceId)}/signed-read`, "POST", {}, {}, parseSignedRead); }
  listSettings(): Promise<AdminSetting[]> { return this.get("/admin/settings", (v) => array(v).map(parseSetting)); }
  updateSetting(key: AdminSetting["key"], value: string, version: number, idempotencyKey?: string): Promise<AdminSetting> { return this.mutate("/admin/settings", "PATCH", { key, value }, { version, idempotencyKey }, parseSetting); }
  publishContract(input: { title: string; content: string; effectiveAt: string }, key?: string): Promise<unknown> { return this.mutate("/admin/contracts", "POST", input, { idempotencyKey: key }, (v) => v); }
  listAudit(): Promise<AuditEvent[]> { return this.get("/admin/audit-events?limit=100", (v) => array(v).map(parseAudit)); }

  private mfaRequest(action: "challenge" | "verify", body: unknown): Promise<unknown> {
    const csrf = readCsrfToken("nr_admin_mfa_csrf");
    if (!csrf) throw new AdminApiError("AUTH_REQUIRED", "หมดเวลายืนยันตัวตน กรุณาเข้าสู่ระบบใหม่");
    return this.request(`/admin/auth/mfa/${action}`, {
      method: "POST", credentials: "same-origin", headers: { accept: "application/json", "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify(body),
    });
  }
  private async get<T>(path: string, parse: (value: unknown) => T): Promise<T> { return parse(await this.request(path, { method: "GET", credentials: "same-origin", headers: { accept: "application/json" } })); }
  private async mutate<T>(path: string, method: string, body: unknown, options: MutationOptions, parse: (value: unknown) => T): Promise<T> {
    const csrf = this.csrfToken();
    if (!csrf) throw new AdminApiError("AUTH_REQUIRED", "เซสชันผู้ดูแลหมดอายุ");
    const headers = new Headers({ accept: "application/json", "x-csrf-token": csrf, "idempotency-key": options.idempotencyKey ?? this.idFactory() });
    if (options.version !== undefined) headers.set("if-match", `"${options.version}"`);
    if (body !== undefined) headers.set("content-type", "application/json");
    const init: RequestInit = { method, headers, credentials: "same-origin", ...(body !== undefined ? { body: JSON.stringify(body) } : {}) };
    return parse(await this.request(path, init, options.retryUnavailable ?? true));
  }
  private async request(path: string, init: RequestInit, retryUnavailable = false): Promise<unknown> {
    const response = await this.fetcher(`/api/v1${path}`, init);
    if (response.status === 503 && retryUnavailable) return this.request(path, init, false);
    if (response.status === 204) return null;
    const body = await response.json().catch(() => null);
    if (!response.ok) throw apiError(body, response.status);
    return body;
  }
}

export function validateConditionImages(files: readonly Pick<File, "type" | "size" | "name">[], uploadedCount = 0): void {
  if (!files.length || uploadedCount + files.length > CONDITION_IMAGE_LIMIT) throw new AdminApiError("UPLOAD_REJECTED", "แนบรูปได้ 1–12 รูปต่อการตรวจสภาพ");
  for (const file of files) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new AdminApiError("UPLOAD_REJECTED", "รองรับเฉพาะรูป JPG, PNG หรือ WebP");
    if (file.size <= 0 || file.size > 10 * 1024 * 1024) throw new AdminApiError("UPLOAD_REJECTED", "แต่ละรูปต้องมีขนาดไม่เกิน 10 MB");
    if (!file.name || file.name.length > 255) throw new AdminApiError("UPLOAD_REJECTED", "ชื่อไฟล์ยาวเกินไป กรุณาเปลี่ยนชื่อไฟล์");
  }
}

function readCsrfToken(name = "nr_admin_csrf"): string | null { if (typeof document === "undefined") return null; const item = document.cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${name}=`)); return item ? decodeURIComponent(item.slice(name.length + 1)) : null; }
function apiError(value: unknown, status: number): AdminApiError { const envelope = objectOrNull(value); const error = objectOrNull(envelope?.error); const code = typeof error?.code === "string" ? error.code : status === 401 ? "AUTH_REQUIRED" : status === 403 ? "FORBIDDEN" : "INTERNAL_ERROR"; return new AdminApiError(code, typeof error?.message === "string" ? error.message : "ดำเนินการไม่สำเร็จ", typeof error?.requestId === "string" ? error.requestId : undefined); }
function parseContext(value: unknown): AdminContext { const source = object(value); const parsedRoles = array(source.roles).map(string).filter((role): role is AdminRole => roles.has(role as AdminRole)); if (!parsedRoles.length) throw new AdminApiError("INTERNAL_ERROR", "ข้อมูลสิทธิ์ผู้ดูแลไม่ถูกต้อง"); return { adminId: string(source.adminId), roles: parsedRoles, mfaVerified: bool(source.mfaVerified), permissions: array(source.permissions).map(string) as AdminPermission[], expiresAt: string(source.expiresAt) }; }
function parseLaptop(value: unknown): AdminLaptop { const source = object(value); const status = string(source.status) as LaptopStatus; if (!laptopStatuses.has(status)) throw new AdminApiError("INTERNAL_ERROR", "สถานะเครื่องไม่ถูกต้อง"); return { id: string(source.id), name: string(source.name), specs: object(source.specs), status, dailyRateSatang: integer(source.dailyRateSatang), depositSatang: integer(source.depositSatang), version: integer(source.version), retiredAt: nullableString(source.retiredAt) }; }
function parseRental(value: unknown): AdminRental { const source = object(value); const rental = object(source.rental); const review = object(source.reviewSummary); const customer = object(source.customerSummary); const status = string(rental.status) as RentalStatus; if (!statuses.has(status)) throw new AdminApiError("INTERNAL_ERROR", "สถานะรายการเช่าไม่ถูกต้อง"); return { id: string(rental.id), laptopId: string(rental.laptopId), startDate: string(rental.startDate), endDate: string(rental.endDate), status, rentalSubtotal: money(rental.rentalSubtotal), deposit: money(rental.deposit), totalDue: money(rental.totalDue), version: integer(rental.version), createdAt: string(rental.createdAt), updatedAt: string(rental.updatedAt), customerSummary: { displayName: string(customer.displayName), phoneMasked: string(customer.phoneMasked) }, reviewSummary: { kycStatus: string(review.kycStatus) as AdminRental["reviewSummary"]["kycStatus"], kycEvidenceIds: Array.isArray(review.kycEvidenceIds) ? review.kycEvidenceIds.map(string) : [], paymentStatus: string(review.paymentStatus) as PaymentStatus | "NOT_SUBMITTED", paymentAttemptId: nullableString(review.paymentAttemptId), paymentEvidenceId: nullableString(review.paymentEvidenceId), beforeInspectionComplete: bool(review.beforeInspectionComplete), afterInspectionComplete: bool(review.afterInspectionComplete) }, allowedCommands: array(source.allowedCommands).map(string).filter((v): v is RentalCommand => commands.has(v as RentalCommand)) }; }
function parseInspection(value: unknown): InspectionSummary { const source = object(value); return { id: string(source.id), type: string(source.type) as InspectionSummary["type"], notes: string(source.notes), evidenceIds: array(source.evidenceIds).map(string), finalizedAt: string(source.finalizedAt) }; }
function parseFinancialSummary(value: unknown): FinancialSummary {
  const source = object(value);
  const disposition = source.disposition === null ? null : object(source.disposition);
  if (disposition && !["NO_FEES", "ITEMIZED"].includes(string(disposition.kind))) throw new AdminApiError("INTERNAL_ERROR", "ผลสรุปการเงินไม่ถูกต้อง");
  return {
    rentalId: string(source.rentalId), version: integer(source.version), depositSatang: satang(source.depositSatang),
    fees: array(source.fees).map((entry) => {
      const fee = object(entry); const type = string(fee.type);
      if (type !== "LATE_FEE" && type !== "DAMAGE_FEE") throw new AdminApiError("INTERNAL_ERROR", "ประเภทค่าธรรมเนียมไม่ถูกต้อง");
      return { id: string(fee.id), type, amountSatang: satang(fee.amountSatang), reason: string(fee.reason) };
    }),
    disposition: disposition ? { inspectionId: string(disposition.inspectionId), kind: disposition.kind as "NO_FEES" | "ITEMIZED", feeTotalSatang: satang(disposition.feeTotalSatang), refundableSatang: satang(disposition.refundableSatang), reason: string(disposition.reason) } : null,
    refunds: array(source.refunds).map((entry) => {
      const refund = object(entry); const status = string(refund.status);
      if (!["NOT_REQUIRED", "PENDING", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"].includes(status)) throw new AdminApiError("INTERNAL_ERROR", "สถานะคืนเงินไม่ถูกต้อง");
      return { id: string(refund.id), status: status as FinancialSummary["refunds"][number]["status"], amountSatang: satang(refund.amountSatang), providerReference: nullableString(refund.providerReference), completedAt: nullableString(refund.completedAt) };
    }),
  };
}
function parseSetting(value: unknown): AdminSetting { const source = object(value); return { key: string(source.key) as AdminSetting["key"], value: source.value, version: integer(source.version), updatedAt: string(source.updatedAt) }; }
function parseAudit(value: unknown): AuditEvent { const source = object(value); return { id: String(source.id), action: string(source.action), actorType: string(source.actorType), occurredAt: string(source.occurredAt), targetType: string(source.targetType), targetId: nullableString(source.targetId), priorStatus: nullableString(source.priorStatus), newStatus: nullableString(source.newStatus), outcome: string(source.outcome) }; }
function parseSignedRead(value: unknown): { readUrl: string; expiresAt: string } { const source = object(value); const readUrl = string(source.readUrl); const parsed = new URL(readUrl, "https://local.invalid"); if (!["https:", "http:"].includes(parsed.protocol)) throw new AdminApiError("INTERNAL_ERROR", "ลิงก์หลักฐานไม่ถูกต้อง"); return { readUrl, expiresAt: string(source.expiresAt) }; }
function money(value: unknown) { const source = object(value); const amountSatang = integer(source.amountSatang); if (amountSatang < 0 || source.currency !== "THB") throw new AdminApiError("INTERNAL_ERROR", "ยอดเงินไม่ถูกต้อง"); return { amountSatang, currency: "THB" as const }; }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new AdminApiError("INTERNAL_ERROR", "ข้อมูลตอบกลับไม่ถูกต้อง"); return value as Record<string, unknown>; }
function objectOrNull(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw new AdminApiError("INTERNAL_ERROR", "ข้อมูลตอบกลับไม่ถูกต้อง"); return value; }
function string(value: unknown): string { if (typeof value !== "string") throw new AdminApiError("INTERNAL_ERROR", "ข้อมูลตอบกลับไม่ถูกต้อง"); return value; }
function nullableString(value: unknown): string | null { return value == null ? null : string(value); }
function integer(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new AdminApiError("INTERNAL_ERROR", "ข้อมูลตัวเลขไม่ถูกต้อง"); return value; }
function satang(value: unknown): number { const amount = integer(value); if (amount < 0) throw new AdminApiError("INTERNAL_ERROR", "ยอดเงินไม่ถูกต้อง"); return amount; }
function bool(value: unknown): boolean { if (typeof value !== "boolean") throw new AdminApiError("INTERNAL_ERROR", "ข้อมูลตอบกลับไม่ถูกต้อง"); return value; }
