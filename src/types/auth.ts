import type { AdminRole, IsoDateTime, Uuid } from "./domain";

export type CustomerSession = {
  kind: "customer";
  customerId: Uuid;
  lineSubject: string;
  expiresAt: IsoDateTime;
};

export type AdminSession = {
  kind: "admin";
  adminId: Uuid;
  roles: AdminRole[];
  mfaVerified: boolean;
  expiresAt: IsoDateTime;
};

export type AppSession = CustomerSession | AdminSession;
