import type { Money, PaymentStatus, RentalStatus, Uuid } from "@/types/domain";

export type ApiErrorCode =
  | "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_ERROR" | "CONFLICT"
  | "INVALID_TRANSITION" | "IDEMPOTENCY_CONFLICT" | "RATE_LIMITED" | "UPLOAD_REJECTED" | "INTERNAL_ERROR";

export class CustomerApiError extends Error {
  constructor(public readonly code: ApiErrorCode, message: string, public readonly requestId?: string) {
    super(message);
  }
}

export interface CustomerLaptop {
  id: Uuid; name: string; dailyRate: Money; deposit: Money; thumbnailUrl: string;
}
export interface CustomerLaptopDetail extends CustomerLaptop { specs: Record<string, unknown>; imageUrls: string[] }
export interface CustomerQuote {
  quoteId: Uuid; laptopId: Uuid; startDate: string; endDate: string; rentalDays: number;
  dailyRate: Money; rentalSubtotal: Money; deposit: Money; totalDue: Money; expiresAt: string;
}
export interface CustomerRental {
  id: Uuid; laptopId: Uuid; startDate: string; endDate: string; status: RentalStatus;
  rentalSubtotal: Money; deposit: Money; totalDue: Money; holdExpiresAt?: string | null;
  version: number; createdAt: string; updatedAt: string;
}
export interface ContractVersion { id: Uuid; version: number; title: string; content: string; contentHash: string; effectiveAt: string }
export interface RentalCompletionSummary {
  kycReady: boolean; paymentStatus: "NOT_SUBMITTED" | PaymentStatus;
  paymentEvidenceId: Uuid | null; acceptedContract: ContractVersion | null;
}
export interface CustomerRentalDetail extends CustomerRental { completionSummary: RentalCompletionSummary }
export interface CustomerRentalCompletion {
  rental: CustomerRentalDetail; contract: ContractVersion | null; payment: PaymentSettings | null;
}
export interface PaymentSettings { qrImageUrl: string; accountDisplayName: string; updatedAt: string }
export interface Page<T> { data: T[]; page: { nextCursor: string | null; hasMore: boolean } }
export interface UploadResult { evidenceId: Uuid; status: "READY" | "QUARANTINED" }

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type RequestOptions = { idempotent?: boolean; retryAuth?: boolean };
const mutationMethods = new Set(["POST", "PATCH", "DELETE"]);
const errorCodes = new Set<ApiErrorCode>([
  "AUTH_REQUIRED", "FORBIDDEN", "NOT_FOUND", "VALIDATION_ERROR", "CONFLICT", "INVALID_TRANSITION",
  "IDEMPOTENCY_CONFLICT", "RATE_LIMITED", "UPLOAD_REJECTED", "INTERNAL_ERROR",
]);
const statuses = new Set<RentalStatus>([
  "DRAFT", "PENDING_PAYMENT", "PENDING_REVIEW", "APPROVED", "PREPARING", "READY_FOR_HANDOVER",
  "ACTIVE", "RETURN_PENDING", "INSPECTION_PENDING", "REFUND_PENDING", "COMPLETED", "REJECTED",
  "CANCELLED", "EXPIRED",
]);

export class CustomerApi {
  constructor(
    private readonly fetcher: FetchLike = fetch,
    private readonly reauthenticate?: () => Promise<void>,
    private readonly csrfToken: () => string | null = readCsrfToken,
    private readonly idempotencyKey: () => string = () => crypto.randomUUID(),
  ) {}

  async listLaptops(startDate?: string, endDate?: string): Promise<Page<CustomerLaptop>> {
    const query = new URLSearchParams({ limit: "100" });
    if (startDate && endDate) { query.set("startDate", startDate); query.set("endDate", endDate); }
    return parsePage(await this.request(`/laptops?${query}`, {}, {}), parseLaptop);
  }
  async getLaptop(laptopId: Uuid): Promise<CustomerLaptopDetail> {
    return parseLaptopDetail(await this.request(`/laptops/${encodeURIComponent(laptopId)}`, {}, {}));
  }
  async createQuote(laptopId: Uuid, startDate: string, endDate: string): Promise<CustomerQuote> {
    return parseQuote(await this.json("/quotes", { laptopId, startDate, endDate }));
  }
  async createRental(quoteId: Uuid, customer: { name: string; phone: string }): Promise<CustomerRental> {
    return parseRental(await this.json("/rentals", { quoteId, customer }, { idempotent: true }));
  }
  async listRentals(): Promise<Page<CustomerRental>> {
    return parsePage(await this.request("/rentals?limit=100", {}, {}), parseRental);
  }
  async getRental(rentalId: Uuid): Promise<CustomerRentalDetail> {
    const source = object(await this.request(`/rentals/${encodeURIComponent(rentalId)}`, {}, {}));
    const summary = object(source.completionSummary);
    const paymentStatus = string(summary.paymentStatus);
    if (!["NOT_SUBMITTED", "PENDING", "SUBMITTED", "VERIFIED", "REJECTED", "VOIDED"].includes(paymentStatus)) {
      throw new CustomerApiError("INTERNAL_ERROR", "สถานะการชำระเงินจากระบบไม่ถูกต้อง");
    }
    const paymentEvidenceId = summary.paymentEvidenceId === null ? null : string(summary.paymentEvidenceId);
    if (paymentEvidenceId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paymentEvidenceId)) {
      throw new CustomerApiError("INTERNAL_ERROR", "หลักฐานการชำระเงินจากระบบไม่ถูกต้อง");
    }
    return { ...parseRental(source), completionSummary: {
      kycReady: boolean(summary.kycReady), paymentStatus: paymentStatus as RentalCompletionSummary["paymentStatus"], paymentEvidenceId,
      acceptedContract: summary.acceptedContract === null ? null : parseContract(summary.acceptedContract),
    } };
  }
  async getRentalCompletion(rentalId: Uuid): Promise<CustomerRentalCompletion> {
    const rental = await this.getRental(rentalId);
    const summary = rental.completionSummary;
    const editable = canCompleteRental(rental) && !isPaymentSubmitted(summary.paymentStatus);
    const [contract, payment] = await Promise.all([
      summary.acceptedContract ? Promise.resolve(summary.acceptedContract) : editable ? this.getCurrentContract() : Promise.resolve(null),
      editable ? this.getPaymentSettings() : Promise.resolve(null),
    ]);
    return { rental, contract, payment };
  }
  async getPublicSettings(): Promise<{ contactLineUrl: string | null }> {
    const value = object(await this.request("/public-settings", {}, {}));
    if (value.contactLineUrl === null) return { contactLineUrl: null };
    const url = string(value.contactLineUrl);
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && ["line.me", "lin.ee"].includes(parsed.hostname) && !parsed.username && !parsed.password && (!parsed.port || parsed.port === "443")) {
        return { contactLineUrl: parsed.href };
      }
    } catch { /* Reject malformed or non-LINE configuration. */ }
    throw new CustomerApiError("INTERNAL_ERROR", "ลิงก์ติดต่อ LINE ยังไม่พร้อมใช้งาน");
  }
  async getCurrentContract(): Promise<ContractVersion> {
    return parseContract(await this.request("/contracts/current", {}, {}));
  }
  async acceptContract(rentalId: Uuid, contract: ContractVersion): Promise<void> {
    await this.json(`/rentals/${encodeURIComponent(rentalId)}/contract-acceptance`, {
      contractVersionId: contract.id, contentHash: contract.contentHash, accepted: true,
    }, { idempotent: true });
  }
  async getPaymentSettings(): Promise<PaymentSettings> {
    const value = object(await this.request("/payment-settings", {}, {}));
    return { qrImageUrl: string(value.qrImageUrl), accountDisplayName: string(value.accountDisplayName), updatedAt: string(value.updatedAt) };
  }
  async uploadEvidence(
    purpose: "KYC_ID" | "PAYMENT_SLIP", rentalId: Uuid, file: File, onProgress?: (percent: number) => void,
  ): Promise<UploadResult> {
    const validation = validatePrivateImage(file);
    if (!validation.valid) throw new CustomerApiError("UPLOAD_REJECTED", validation.reason!);
    const intent = object(await this.json("/uploads/intents", {
      purpose, targetId: rentalId, filename: file.name, mimeType: file.type, sizeBytes: file.size,
    }));
    const uploadId = string(intent.uploadId);
    const headers = new Headers(recordOfStrings(intent.headers));
    if (!headers.has("content-type")) headers.set("content-type", file.type);
    onProgress?.(0);
    const upload = await this.fetcher(string(intent.uploadUrl), { method: "PUT", body: file, headers, credentials: "omit" });
    if (!upload.ok) throw new CustomerApiError("UPLOAD_REJECTED", "อัปโหลดไฟล์ไม่สำเร็จ กรุณาลองอีกครั้ง");
    onProgress?.(100);
    const result = object(await this.json(`/uploads/${encodeURIComponent(uploadId)}/finalize`, {}, { idempotent: true }));
    const status = string(result.status);
    if (status !== "READY" && status !== "QUARANTINED") throw new CustomerApiError("INTERNAL_ERROR", "สถานะไฟล์จากระบบไม่ถูกต้อง");
    return { evidenceId: string(result.evidenceId), status };
  }
  async submitPayment(rentalId: Uuid, evidenceId: Uuid): Promise<void> {
    await this.json(`/rentals/${encodeURIComponent(rentalId)}/payments`, { type: "RENT_AND_DEPOSIT", evidenceId }, { idempotent: true });
  }

  private json(path: string, body: unknown, options: RequestOptions = {}): Promise<unknown> {
    return this.request(path, { method: "POST", body: JSON.stringify(body) }, options);
  }
  private async request(path: string, init: RequestInit, options: RequestOptions, retried = false): Promise<unknown> {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body) headers.set("content-type", "application/json");
    if (options.idempotent && !headers.has("idempotency-key")) headers.set("idempotency-key", this.idempotencyKey());
    if (mutationMethods.has(method)) {
      const csrf = this.csrfToken();
      if (!csrf) throw new CustomerApiError("AUTH_REQUIRED", "เซสชันหมดอายุ กรุณาเชื่อมต่อ LINE อีกครั้ง");
      headers.set("x-csrf-token", csrf);
    }
    const response = await this.fetcher(`/api/v1${path}`, { ...init, headers, credentials: "same-origin" });
    if (response.status === 401 && !retried && options.retryAuth !== false && this.reauthenticate) {
      try { await this.reauthenticate(); }
      catch { throw new CustomerApiError("AUTH_REQUIRED", "เซสชันหมดอายุ กรุณาเชื่อมต่อ LINE อีกครั้ง"); }
      return this.request(path, { ...init, headers }, options, true);
    }
    if (response.status === 204) return null;
    const body = await response.json().catch(() => null);
    if (!response.ok) throw apiError(body);
    return body;
  }
}

export function formatMoney(money: Money): string {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(money.amountSatang / 100);
}
export function canCompleteRental(rental: CustomerRental, now = Date.now()): boolean {
  return ["PENDING_PAYMENT", "PENDING_REVIEW"].includes(rental.status)
    && (rental.holdExpiresAt == null || Date.parse(rental.holdExpiresAt) > now);
}
export function isPaymentSubmitted(status: RentalCompletionSummary["paymentStatus"]): boolean {
  return status === "PENDING" || status === "SUBMITTED" || status === "VERIFIED";
}
export function formatBangkokDateTime(utcInstant: string): string {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(utcInstant));
}
export interface UploadValidation { valid: boolean; reason?: string }
export function validatePrivateImage(file: Pick<File, "type" | "size">): UploadValidation {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return { valid: false, reason: "รองรับเฉพาะ JPG, PNG หรือ WebP" };
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) return { valid: false, reason: "ไฟล์ต้องมีขนาดไม่เกิน 10 MB" };
  return { valid: true };
}
export function validateCustomer(name: string, phone: string): boolean {
  return name.trim().length > 0 && name.trim().length <= 120 && /^\+?[0-9]{9,15}$/.test(phone);
}
export function validateDateRange(startDate: string, endDate: string, today = bangkokToday()): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate) && startDate >= today && endDate >= startDate;
}
export function customerErrorMessage(error: unknown): string {
  if (!(error instanceof CustomerApiError)) return "ระบบขัดข้อง กรุณาลองอีกครั้ง";
  if (error.code === "AUTH_REQUIRED") return "เซสชันหมดอายุ กรุณาเชื่อมต่อ LINE อีกครั้ง";
  if (["CONFLICT", "IDEMPOTENCY_CONFLICT"].includes(error.code)) return "เครื่องหรือรายการนี้เพิ่งเปลี่ยน กรุณาเลือกวันใหม่แล้วลองอีกครั้ง";
  if (error.code === "UPLOAD_REJECTED") return error.message;
  if (error.code === "RATE_LIMITED") return "ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองอีกครั้ง";
  return error.message || "ระบบขัดข้อง กรุณาลองอีกครั้ง";
}

function readCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const value = document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith("nr_csrf="));
  return value ? decodeURIComponent(value.slice("nr_csrf=".length)) : null;
}
function bangkokToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function apiError(value: unknown): CustomerApiError {
  const envelope = objectOrNull(value); const error = objectOrNull(envelope?.error);
  const code = typeof error?.code === "string" && errorCodes.has(error.code as ApiErrorCode) ? error.code as ApiErrorCode : "INTERNAL_ERROR";
  return new CustomerApiError(code, typeof error?.message === "string" ? error.message : "ระบบขัดข้อง กรุณาลองอีกครั้ง", typeof error?.requestId === "string" ? error.requestId : undefined);
}
function parsePage<T>(value: unknown, item: (value: unknown) => T): Page<T> {
  const source = object(value); const page = object(source.page);
  return { data: array(source.data).map(item), page: { nextCursor: page.nextCursor === null ? null : string(page.nextCursor), hasMore: boolean(page.hasMore) } };
}
function parseLaptop(value: unknown): CustomerLaptop {
  const source = object(value);
  return { id: string(source.id), name: string(source.name), dailyRate: money(source.dailyRate), deposit: money(source.deposit), thumbnailUrl: string(source.thumbnailUrl) };
}
function parseLaptopDetail(value: unknown): CustomerLaptopDetail {
  const source = object(value);
  return { ...parseLaptop(source), specs: object(source.specs), imageUrls: array(source.imageUrls).map(string) };
}
function parseQuote(value: unknown): CustomerQuote {
  const source = object(value);
  return {
    quoteId: string(source.quoteId), laptopId: string(source.laptopId), startDate: string(source.startDate), endDate: string(source.endDate), rentalDays: number(source.rentalDays),
    dailyRate: money(source.dailyRate), rentalSubtotal: money(source.rentalSubtotal), deposit: money(source.deposit), totalDue: money(source.totalDue), expiresAt: string(source.expiresAt),
  };
}
function parseRental(value: unknown): CustomerRental {
  const source = object(value); const status = string(source.status) as RentalStatus;
  if (!statuses.has(status)) throw new CustomerApiError("INTERNAL_ERROR", "สถานะรายการจากระบบไม่ถูกต้อง");
  return {
    id: string(source.id), laptopId: string(source.laptopId), startDate: string(source.startDate), endDate: string(source.endDate), status,
    rentalSubtotal: money(source.rentalSubtotal), deposit: money(source.deposit), totalDue: money(source.totalDue),
    holdExpiresAt: source.holdExpiresAt === null || source.holdExpiresAt === undefined ? null : string(source.holdExpiresAt),
    version: number(source.version), createdAt: string(source.createdAt), updatedAt: string(source.updatedAt),
  };
}
function parseContract(value: unknown): ContractVersion {
  const source = object(value); const contentHash = string(source.contentHash);
  if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new CustomerApiError("INTERNAL_ERROR", "สัญญาจากระบบไม่ถูกต้อง");
  return { id: string(source.id), version: number(source.version), title: string(source.title), content: string(source.content), contentHash, effectiveAt: string(source.effectiveAt) };
}
function money(value: unknown): Money {
  const source = object(value); const amountSatang = number(source.amountSatang);
  if (!Number.isSafeInteger(amountSatang) || amountSatang < 0 || source.currency !== "THB") throw new CustomerApiError("INTERNAL_ERROR", "ยอดเงินจากระบบไม่ถูกต้อง");
  return { amountSatang, currency: "THB" };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CustomerApiError("INTERNAL_ERROR", "ข้อมูลตอบกลับจากระบบไม่ถูกต้อง");
  return value as Record<string, unknown>;
}
function objectOrNull(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw new CustomerApiError("INTERNAL_ERROR", "ข้อมูลตอบกลับจากระบบไม่ถูกต้อง"); return value; }
function string(value: unknown): string { if (typeof value !== "string") throw new CustomerApiError("INTERNAL_ERROR", "ข้อมูลตอบกลับจากระบบไม่ถูกต้อง"); return value; }
function number(value: unknown): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new CustomerApiError("INTERNAL_ERROR", "ข้อมูลตอบกลับจากระบบไม่ถูกต้อง"); return value; }
function boolean(value: unknown): boolean { if (typeof value !== "boolean") throw new CustomerApiError("INTERNAL_ERROR", "ข้อมูลตอบกลับจากระบบไม่ถูกต้อง"); return value; }
function recordOfStrings(value: unknown): Record<string, string> {
  const source = object(value); const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(source)) { if (typeof item !== "string") throw new CustomerApiError("INTERNAL_ERROR", "ข้อมูลอัปโหลดไม่ถูกต้อง"); result[key] = item; }
  return result;
}
