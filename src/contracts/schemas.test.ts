import { describe, expect, it } from "vitest";

import { dateRangeSchema, idempotencyKeySchema, moneySatangSchema } from "./schemas";

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
});
