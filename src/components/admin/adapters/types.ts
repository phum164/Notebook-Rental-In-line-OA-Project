import type { AdminRole, InspectionType, LaptopStatus, Money, PaymentStatus, RentalStatus } from "@/types/domain";

export type AdminPermission =
  | "rental:read"
  | "audit:read"
  | "evidence:review"
  | "rental:review"
  | "inventory:write"
  | "inspection:write"
  | "finance:write"
  | "settings:write";

export type AdminContext = {
  adminId: string;
  roles: readonly AdminRole[];
  mfaVerified: boolean;
  expiresAt: string;
  permissions: readonly AdminPermission[];
};

export type AdminLaptop = {
  id: string;
  name: string;
  specs: Record<string, unknown>;
  status: LaptopStatus;
  dailyRateSatang: number;
  depositSatang: number;
  version: number;
  retiredAt: string | null;
};

export type AdminRental = {
  id: string;
  laptopId: string;
  status: RentalStatus;
  startDate: string;
  endDate: string;
  rentalSubtotal: Money;
  deposit: Money;
  totalDue: Money;
  version: number;
  createdAt: string;
  updatedAt: string;
  customerSummary: { displayName: string; phoneMasked: string };
  reviewSummary: {
    kycStatus: "NOT_SUBMITTED" | "PENDING" | "VERIFIED" | "REJECTED";
    kycEvidenceIds: string[];
    paymentStatus: PaymentStatus | "NOT_SUBMITTED";
    paymentAttemptId: string | null;
    paymentEvidenceId: string | null;
    beforeInspectionComplete: boolean;
    afterInspectionComplete: boolean;
  };
  allowedCommands: RentalCommand[];
};

export type EvidenceSummary = {
  id: string;
  purpose: "KYC" | "PAYMENT_SLIP" | "CONDITION";
  label: string;
  maskedSubject: string;
};

export type InspectionSummary = {
  id: string;
  type: InspectionType;
  notes: string;
  evidenceIds: string[];
  finalizedAt: string;
};

export type AuditEvent = {
  id: string;
  action: string;
  actorType: string;
  occurredAt: string;
  targetType: string;
  targetId: string | null;
  priorStatus: string | null;
  newStatus: string | null;
  outcome: string;
};

export type RentalCommand = "approve" | "reject" | "start-preparation" | "mark-ready" | "handover" | "request-return" | "receive-return" | "finalize-inspection" | "complete-settlement";
export type FinancialSummary = {
  rentalId: string;
  version: number;
  depositSatang: number;
  fees: { id: string; type: "LATE_FEE" | "DAMAGE_FEE"; amountSatang: number; reason: string }[];
  disposition: null | { inspectionId: string; kind: "NO_FEES" | "ITEMIZED"; feeTotalSatang: number; refundableSatang: number; reason: string };
  refunds: { id: string; status: "NOT_REQUIRED" | "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED"; amountSatang: number; providerReference: string | null; completedAt: string | null }[];
};
export type AdminSetting = { key: "PAYMENT_INSTRUCTIONS" | "CONTACT_LINE_URL" | "AUTO_REPLY_TEXT"; value: unknown; version: number; updatedAt: string };
export type LaptopInput = { name: string; specs: Record<string, unknown>; dailyRateSatang: number; depositSatang: number };
