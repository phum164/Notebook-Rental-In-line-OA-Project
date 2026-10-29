import type { AdminRole, IsoDateTime, Uuid } from "./domain";

export const SESSION_DB_SCOPES = [
  "session:bootstrap",
  "session:resolve",
  "session:revoke",
] as const;
export type SessionDbScope = (typeof SESSION_DB_SCOPES)[number];

export type LineBootstrap = {
  nonce: string;
  expiresAt: IsoDateTime;
};

export type SessionDatabaseClaims = {
  iss: string;
  aud: string;
  role: "app_session_service";
  sub: Uuid;
  principal_type: "session_service";
  scope: SessionDbScope;
  jti: Uuid;
  iat: number;
  nbf: number;
  exp: number;
};

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
