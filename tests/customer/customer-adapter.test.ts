import { describe, expect, it } from "vitest";
import { formatBangkokDateTime, formatMoney, getMockSnapshot, makeMockQuote, MOCK_LAPTOPS, validateCustomer, validatePrivateImage } from "../../src/lib/liff/customer-adapter";
import { sessionView } from "../../src/lib/liff/session";

describe("customer mock adapter", () => {
  it("creates an inclusive server-shaped quote with integer satang", () => {
    const quote = makeMockQuote(MOCK_LAPTOPS[0]!, "2026-07-20", "2026-07-22");
    expect(quote?.rentalDays).toBe(3);
    expect(quote?.rentalSubtotal.amountSatang).toBe(105_000);
    expect(quote?.totalDue.amountSatang).toBe(405_000);
    expect(formatMoney(quote!.totalDue)).toContain("4,050");
  });

  it("rejects invalid forms and invalid date ranges", () => {
    expect(validateCustomer("", "0812345678")).toBe(false);
    expect(validateCustomer("ลูกค้า", "0812345678")).toBe(true);
    expect(makeMockQuote(MOCK_LAPTOPS[0]!, "2026-07-22", "2026-07-20")).toBeNull();
  });

  it("enforces private upload allowlist and 10 MiB limit", () => {
    expect(validatePrivateImage({ type: "application/pdf", size: 100 }).valid).toBe(false);
    expect(validatePrivateImage({ type: "image/png", size: 10 * 1024 * 1024 + 1 }).valid).toBe(false);
    expect(validatePrivateImage({ type: "image/webp", size: 1024 }).valid).toBe(true);
  });

  it.each(["expired", "conflict", "upload-failure"] as const)("exposes the %s recovery state", (scenario) => {
    expect(getMockSnapshot(scenario).message).toBeTruthy();
  });

  it("models expired LIFF session recovery without trusting a client identity", () => {
    expect(sessionView("expired")).toEqual({ state: "expired", message: "เซสชันหมดอายุ", actionLabel: "เข้าสู่ระบบผ่าน LINE อีกครั้ง" });
  });

  it("displays UTC instants in Asia/Bangkok", () => {
    expect(formatBangkokDateTime("2026-07-13T10:05:00Z")).toMatch(/17:05|17\.05/);
  });
});
