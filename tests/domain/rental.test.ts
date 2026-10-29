import { describe, expect, it } from "vitest";

import { requestHash } from "../../src/domain/idempotency";
import {
  allowedRentalCommands,
  calculateQuote,
  DomainConflict,
  inclusiveRentalDays,
  nextRentalStatus,
} from "../../src/domain/rental";

describe("rental domain", () => {
  it("calculates inclusive Bangkok civil dates in integer satang", () => {
    expect(inclusiveRentalDays("2026-07-20", "2026-07-22")).toBe(3);
    expect(calculateQuote(45_000, 300_000, "2026-07-20", "2026-07-22")).toEqual({
      rentalDays: 3,
      dailyRate: { amountSatang: 45_000, currency: "THB" },
      rentalSubtotal: { amountSatang: 135_000, currency: "THB" },
      deposit: { amountSatang: 300_000, currency: "THB" },
      totalDue: { amountSatang: 435_000, currency: "THB" },
    });
    expect(() => calculateQuote(Number.MAX_SAFE_INTEGER, 0, "2026-07-20", "2026-07-22")).toThrow(DomainConflict);
  });

  it("allows only role-appropriate named transitions with satisfied guards", () => {
    expect(allowedRentalCommands("PENDING_REVIEW", ["REVIEWER"])).toEqual(["approve", "reject"]);
    expect(nextRentalStatus("PENDING_REVIEW", "approve", { kycVerified: true, paymentVerified: true })).toBe("APPROVED");
    expect(() => nextRentalStatus("PENDING_REVIEW", "approve", { kycVerified: true })).toThrow(DomainConflict);
    expect(() => nextRentalStatus("ACTIVE", "approve", { kycVerified: true, paymentVerified: true })).toThrow(DomainConflict);
  });

  it("hashes semantically identical request objects identically", () => {
    expect(requestHash({ b: 2, a: { d: 4, c: 3 } })).toBe(requestHash({ a: { c: 3, d: 4 }, b: 2 }));
    expect(requestHash({ amountSatang: 100 })).not.toBe(requestHash({ amountSatang: 101 }));
  });
  it("requires an explicit return request and prevents paid rejection or unreasoned financial disposition", () => {
    expect(allowedRentalCommands("ACTIVE", ["OPERATIONS"])).toEqual(["request-return"]);
    expect(nextRentalStatus("ACTIVE", "request-return", { reason: "Customer arranged return" })).toBe("RETURN_PENDING");
    expect(() => nextRentalStatus("ACTIVE", "request-return", {})).toThrow(DomainConflict);
    expect(() => nextRentalStatus("PENDING_REVIEW", "reject", { reason: "Rejected", paymentVerified: true })).toThrow(DomainConflict);
    expect(() => nextRentalStatus("INSPECTION_PENDING", "finalize-inspection", { afterInspectionComplete: true, feeDispositionRecorded: true })).toThrow(DomainConflict);
  });
});
