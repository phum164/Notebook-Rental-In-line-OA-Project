import type {
  AdminRole,
  InspectionType,
  LaptopStatus,
  MoneySatang,
  RefundStatus,
  RentalStatus,
} from "@/types/domain";

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
  displayName: string;
  role: AdminRole;
  mfaVerifiedAt: string;
  expiresAt: string;
  permissions: readonly AdminPermission[];
};

export type AdminLaptop = {
  id: string;
  assetCode: string;
  model: string;
  status: LaptopStatus;
  dailyRateSatang: MoneySatang;
  version: string;
  retiredAt?: string;
};

export type AdminRental = {
  id: string;
  reference: string;
  laptopAssetCode: string;
  customerLabel: string;
  status: RentalStatus;
  startDate: string;
  endDate: string;
  totalDueSatang: MoneySatang;
  version: string;
  review: { kyc: "PENDING" | "VERIFIED"; payment: "PENDING" | "VERIFIED" };
  beforeInspectionComplete: boolean;
  afterInspectionComplete: boolean;
  feeDispositionComplete: boolean;
  refundStatus: RefundStatus;
};

export type EvidenceSummary = {
  id: string;
  purpose: "KYC" | "PAYMENT_SLIP" | "CONDITION";
  label: string;
  maskedSubject: string;
};

export type InspectionSummary = {
  id: string;
  rentalReference: string;
  type: InspectionType;
  evidenceCount: number;
  finalizedAt: string;
  supersedesId?: string;
};

export type AuditEvent = {
  id: string;
  action: string;
  actorLabel: string;
  occurredAt: string;
  reason: string;
  target: string;
};

export type AdminAdapter = {
  getContext(): Promise<AdminContext>;
  listLaptops(includeRetired?: boolean): Promise<readonly AdminLaptop[]>;
  listRentals(): Promise<readonly AdminRental[]>;
  getRental(id: string): Promise<AdminRental | undefined>;
  listEvidence(rentalId: string): Promise<readonly EvidenceSummary[]>;
  listInspections(): Promise<readonly InspectionSummary[]>;
  listAudit(): Promise<readonly AuditEvent[]>;
};
