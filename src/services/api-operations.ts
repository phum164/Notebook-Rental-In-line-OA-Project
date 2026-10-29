import type { AdminRole } from "@/types/domain";

export type CustomerPrincipal = {
  kind: "customer";
  id: string;
  dbToken?: string;
  csrfHash?: string;
  sessionTokenHash?: string;
};
export type AdminPrincipal = {
  kind: "admin";
  id: string;
  roles: AdminRole[];
  mfaVerified: boolean;
  mfaVerifiedAt?: string;
  dbToken?: string;
  csrfToken?: string;
};
export type Principal = CustomerPrincipal | AdminPrincipal;

export type ApiOperation =
  | "startAdminLogin"
  | "completeAdminLogin"
  | "challengeAdminMfa"
  | "verifyAdminMfa"
  | "createLineBootstrap"
  | "createLineSession"
  | "deleteCurrentSession"
  | "deleteAdminSession"
  | "listLaptops"
  | "getLaptop"
  | "getCurrentContract"
  | "getPaymentSettings"
  | "getCustomerPublicSettings"
  | "createQuote"
  | "listOwnRentals"
  | "createRental"
  | "getOwnRental"
  | "acceptRentalContract"
  | "submitRentalPayment"
  | "createUploadIntent"
  | "finalizeUpload"
  | "getAdminSession"
  | "listAdminRentals"
  | "getAdminRental"
  | "listAdminLaptops"
  | "verifyRentalKyc"
  | "rejectRentalKyc"
  | "verifyRentalPayment"
  | "rejectRentalPayment"
  | "createAdminLaptop"
  | "updateAdminLaptop"
  | "retireAdminLaptop"
  | "setAdminLaptopStatus"
  | "attachAdminLaptopImage"
  | "executeRentalCommand"
  | "requestRentalRefund"
  | "getRentalFinancialSummary"
  | "confirmRentalRefund"
  | "listRentalInspections"
  | "createRentalInspection"
  | "createRentalFeeObligation"
  | "listAdminRentalHistory"
  | "createEvidenceSignedRead"
  | "listAdminSettings"
  | "updateAdminSettings"
  | "publishAdminContract"
  | "listAdminAuditEvents";

export type OperationContext = {
  requestId: string;
  principal: Principal | null;
  idempotencyKey?: string;
  ifMatch?: string;
  userAgentHash?: string;
};

export type OperationResult = {
  status: number;
  body?: unknown;
  headers?: HeadersInit;
};

export interface ApiOperations {
  resolveSession(kind: Principal["kind"], token: string): Promise<Principal | null>;
  execute(operation: ApiOperation, input: unknown, context: OperationContext): Promise<OperationResult>;
}

export class OperationUnavailable extends Error {}

export const unavailableOperations: ApiOperations = {
  async resolveSession() {
    return null;
  },
  async execute() {
    throw new OperationUnavailable("Database command RPC/session persistence is not installed");
  },
};
