import { describe, expect, it } from "vitest";
import { createMockAdminAdapter } from "../../src/components/admin/adapters/mock-admin";

describe("admin mock adapter", () => {
  it("preserves retired inventory history", async () => {
    const adapter = createMockAdminAdapter("OPERATIONS");
    expect((await adapter.listLaptops()).some((item) => item.status === "RETIRED")).toBe(false);
    const retired = (await adapter.listLaptops(true)).find((item) => item.status === "RETIRED");
    expect(retired?.retiredAt).toBeTruthy();
  });
  it("masks case data and never returns a permanent media URL", async () => {
    const evidence = await createMockAdminAdapter("REVIEWER").listEvidence("rental-001");
    expect(evidence.every((item) => item.maskedSubject.includes("••"))).toBe(true);
    expect(JSON.stringify(evidence)).not.toMatch(/https?:\/\//);
    expect(JSON.stringify(evidence)).not.toMatch(/signed|objectKey/i);
  });
  it("returns permissions derived from role, not fixture claims", async () => {
    const context = await createMockAdminAdapter("VIEWER").getContext();
    expect(context.permissions).toEqual(["rental:read", "audit:read"]);
  });
});
