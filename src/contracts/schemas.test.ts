import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  dateRangeSchema,
  idempotencyKeySchema,
  issuedLineBootstrapNonceSchema,
  moneySatangSchema,
  rejectKycCommandSchema,
  rejectPaymentCommandSchema,
  verifyKycCommandSchema,
  verifyPaymentCommandSchema,
} from "./schemas";

describe("shared contract schemas", () => {
  it("accepts an inclusive one-day range", () => {
    expect(
      dateRangeSchema.parse({ startDate: "2026-07-13", endDate: "2026-07-13" }),
    ).toEqual({ startDate: "2026-07-13", endDate: "2026-07-13" });
  });

  it("rejects an inverted date range", () => {
    expect(() =>
      dateRangeSchema.parse({ startDate: "2026-07-14", endDate: "2026-07-13" }),
    ).toThrow();
  });

  it("rejects fractional or negative money", () => {
    expect(moneySatangSchema.safeParse(100.5).success).toBe(false);
    expect(moneySatangSchema.safeParse(-1).success).toBe(false);
  });

  it("requires a bounded URL-safe idempotency key", () => {
    expect(idempotencyKeySchema.safeParse("booking:customer:0123456789").success).toBe(true);
    expect(idempotencyKeySchema.safeParse("short").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("invalid key with spaces").success).toBe(false);
  });

  it("accepts only server-issued nonce syntax", () => {
    expect(issuedLineBootstrapNonceSchema.safeParse("0123456789abcdef0123456789abcdef").success).toBe(true);
    expect(issuedLineBootstrapNonceSchema.safeParse("short-or browser supplied").success).toBe(false);
  });

  it("keeps KYC verify and reject payloads explicit", () => {
    const evidenceIds = ["10000000-0000-4000-8000-000000000001"];
    expect(verifyKycCommandSchema.safeParse({ evidenceIds }).success).toBe(true);
    expect(rejectKycCommandSchema.safeParse({ evidenceIds }).success).toBe(false);
    expect(rejectKycCommandSchema.safeParse({ evidenceIds, reason: "ภาพไม่ชัด" }).success).toBe(true);
    expect(verifyKycCommandSchema.safeParse({ evidenceIds: [...evidenceIds, ...evidenceIds] }).success).toBe(false);
  });

  it("requires payment verification reference and explicit review reasons", () => {
    expect(verifyPaymentCommandSchema.safeParse({ providerReference: "BANK-001", reason: "ยอดตรง" }).success).toBe(true);
    expect(verifyPaymentCommandSchema.safeParse({ providerReference: "BANK-001" }).success).toBe(false);
    expect(rejectPaymentCommandSchema.safeParse({ reason: "ยอดไม่ตรง" }).success).toBe(true);
    expect(rejectPaymentCommandSchema.safeParse({}).success).toBe(false);
  });

  it("publishes independent bootstrap and review operations", () => {
    const openApi = readFileSync(new URL("../../docs/contracts/openapi.yaml", import.meta.url), "utf8");
    for (const operation of [
      "createLineBootstrap",
      "startAdminLogin",
      "completeAdminLogin",
      "verifyRentalKyc",
      "rejectRentalKyc",
      "verifyRentalPayment",
      "rejectRentalPayment",
    ]) {
      expect(openApi).toContain(`operationId: ${operation}`);
    }
    expect(openApi).toContain("approve returns INVALID_TRANSITION");
    expect(openApi).toContain("AUTH_REQUIRED when the LINE credential or browser-bound nonce");
  });
});
