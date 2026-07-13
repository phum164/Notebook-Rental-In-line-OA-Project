export const LAPTOP_STATUSES = [
  "AVAILABLE",
  "RESERVED",
  "RENTED",
  "MAINTENANCE",
  "RETIRED",
] as const;
export type LaptopStatus = (typeof LAPTOP_STATUSES)[number];

export const RENTAL_STATUSES = [
  "DRAFT",
  "PENDING_PAYMENT",
  "PENDING_REVIEW",
  "APPROVED",
  "PREPARING",
  "READY_FOR_HANDOVER",
  "ACTIVE",
  "RETURN_PENDING",
  "INSPECTION_PENDING",
  "REFUND_PENDING",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
  "EXPIRED",
] as const;
export type RentalStatus = (typeof RENTAL_STATUSES)[number];

export const PAYMENT_STATUSES = [
  "PENDING",
  "SUBMITTED",
  "VERIFIED",
  "REJECTED",
  "VOIDED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_TYPES = [
  "RENT_AND_DEPOSIT",
  "LATE_FEE",
  "DAMAGE_FEE",
  "REFUND",
] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const REFUND_STATUSES = [
  "NOT_REQUIRED",
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const INSPECTION_TYPES = ["BEFORE_RENT", "AFTER_RETURN"] as const;
export type InspectionType = (typeof INSPECTION_TYPES)[number];

export const ADMIN_ROLES = ["OWNER", "OPERATIONS", "REVIEWER", "VIEWER"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export type Uuid = string;
export type IsoDate = string;
export type IsoDateTime = string;
export type MoneySatang = number;

export interface Money {
  amountSatang: MoneySatang;
  currency: "THB";
}

export interface DateRange {
  startDate: IsoDate;
  endDate: IsoDate;
}

export interface RentalQuote {
  quoteId: Uuid;
  laptopId: Uuid;
  dateRange: DateRange;
  rentalDays: number;
  dailyRate: Money;
  rentalSubtotal: Money;
  deposit: Money;
  totalDue: Money;
  expiresAt: IsoDateTime;
}
