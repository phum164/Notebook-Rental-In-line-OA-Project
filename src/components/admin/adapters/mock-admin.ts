import type { AdminRole } from "@/types/domain";
import { permissionsForRole } from "../policy";
import type { AdminAdapter, AdminContext, AdminLaptop, AdminRental } from "./types";

const laptops: readonly AdminLaptop[] = [
  { id: "lap-001", assetCode: "NB-014", model: "ThinkPad T14 Gen 4", status: "RESERVED", dailyRateSatang: 89000, version: "v7" },
  { id: "lap-002", assetCode: "NB-021", model: "MacBook Air M2", status: "AVAILABLE", dailyRateSatang: 129000, version: "v3" },
  { id: "lap-003", assetCode: "NB-009", model: "Dell Latitude 5440", status: "MAINTENANCE", dailyRateSatang: 79000, version: "v11" },
  { id: "lap-004", assetCode: "NB-004", model: "IdeaPad Slim 5", status: "RETIRED", dailyRateSatang: 69000, version: "v15", retiredAt: "2026-07-10T09:00:00Z" },
] as const;

const rentals: readonly AdminRental[] = [
  {
    id: "rental-001", reference: "R-260713-018", laptopAssetCode: "NB-014", customerLabel: "ลูกค้า •••• 4821",
    status: "PENDING_REVIEW", startDate: "2026-07-15", endDate: "2026-07-18", totalDueSatang: 706000, version: "v4",
    review: { kyc: "PENDING", payment: "PENDING" }, beforeInspectionComplete: false, afterInspectionComplete: false,
    feeDispositionComplete: false, refundStatus: "NOT_REQUIRED",
  },
  {
    id: "rental-002", reference: "R-260711-006", laptopAssetCode: "NB-008", customerLabel: "ลูกค้า •••• 9034",
    status: "PREPARING", startDate: "2026-07-14", endDate: "2026-07-20", totalDueSatang: 1123000, version: "v9",
    review: { kyc: "VERIFIED", payment: "VERIFIED" }, beforeInspectionComplete: false, afterInspectionComplete: false,
    feeDispositionComplete: false, refundStatus: "NOT_REQUIRED",
  },
  {
    id: "rental-003", reference: "R-260701-002", laptopAssetCode: "NB-003", customerLabel: "ลูกค้า •••• 1176",
    status: "INSPECTION_PENDING", startDate: "2026-07-02", endDate: "2026-07-09", totalDueSatang: 1312000, version: "v16",
    review: { kyc: "VERIFIED", payment: "VERIFIED" }, beforeInspectionComplete: true, afterInspectionComplete: true,
    feeDispositionComplete: false, refundStatus: "NOT_REQUIRED",
  },
] as const;

export function createMockAdminAdapter(role: AdminRole = "OWNER"): AdminAdapter {
  const context: AdminContext = {
    adminId: "admin-mock-owner",
    displayName: `ผู้ดูแลระบบ (${role})`,
    role,
    permissions: permissionsForRole(role),
    mfaVerifiedAt: "2026-07-13T08:52:00Z",
    expiresAt: "2026-07-13T16:00:00Z",
  };
  return {
    async getContext() { return context; },
    async listLaptops(includeRetired = false) { return includeRetired ? laptops : laptops.filter((item) => !item.retiredAt); },
    async listRentals() { return rentals; },
    async getRental(id) { return rentals.find((item) => item.id === id); },
    async listEvidence(rentalId) {
      if (rentalId !== "rental-001") return [];
      return [
        { id: "evidence-kyc-opaque-1", purpose: "KYC", label: "เอกสารยืนยันตัวตน", maskedSubject: "เลขเอกสาร ••••••••4821" },
        { id: "evidence-slip-opaque-1", purpose: "PAYMENT_SLIP", label: "หลักฐานชำระเงิน", maskedSubject: "รายการ ••••018" },
      ] as const;
    },
    async listInspections() {
      return [
        { id: "inspection-001", rentalReference: "R-260701-002", type: "BEFORE_RENT", evidenceCount: 4, finalizedAt: "2026-07-02T03:15:00Z" },
        { id: "inspection-002", rentalReference: "R-260701-002", type: "AFTER_RETURN", evidenceCount: 5, finalizedAt: "2026-07-10T04:40:00Z" },
      ];
    },
    async listAudit() {
      return [
        { id: "audit-1", action: "RENTAL_APPROVED", actorLabel: "Reviewer ••••27", occurredAt: "2026-07-13T03:18:00Z", reason: "เอกสารและยอดชำระตรงตามรายการ", target: "R-260711-006" },
        { id: "audit-2", action: "LAPTOP_RETIRED", actorLabel: "Owner ••••01", occurredAt: "2026-07-10T09:00:00Z", reason: "สิ้นสุดอายุการใช้งาน", target: "NB-004" },
      ];
    },
  };
}

export const mockAdminAdapter = createMockAdminAdapter();
