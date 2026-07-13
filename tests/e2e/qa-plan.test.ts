import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fixtures from "../fixtures/synthetic-fixtures.json";

const testPlan = readFileSync("docs/testing/test-plan.md", "utf8");
const traceability = readFileSync("docs/testing/traceability-matrix.md", "utf8");
const criticalScenarios = readFileSync("docs/testing/critical-e2e-scenarios.md", "utf8");
const negativePlan = readFileSync("docs/testing/security-negative-plan.md", "utf8");

describe("A06 Wave 1 QA plan invariants", () => {
  it("retains every SRD capability in the traceability matrix", () => {
    for (const requirement of [
      "SRD-C01", "SRD-C02", "SRD-C03", "SRD-C04", "SRD-C05", "SRD-C06",
      "SRD-A01", "SRD-A02", "SRD-A03", "SRD-A04", "SRD-A05",
      "SRD-P01", "SRD-P02", "SRD-P03", "SRD-P04", "SRD-P05",
    ]) {
      expect(traceability).toContain(`\`${requirement}\``);
    }
  });

  it("marks live database and integration gates as not run or blocked", () => {
    expect(testPlan).toContain("not run");
    expect(testPlan).toContain("no runnable isolated Supabase/PostgreSQL gateway");
    expect(negativePlan).toContain("Required live commands/procedures (not run)");
  });

  it("defines the critical lifecycle and required negative boundaries", () => {
    expect(criticalScenarios).toContain("`E2E-CRIT-01`");
    for (const boundary of ["LINE bootstrap", "Customer DB JWT", "RLS/Storage", "Webhook", "Concurrency", "Money", "Accessibility"]) {
      expect(`${testPlan}\n${negativePlan}`).toMatch(new RegExp(boundary, "i"));
    }
  });

  it("uses deterministic integer-satang inclusive-date fixtures", () => {
    const oneDay = fixtures.dateCases.find((item) => item.key === "oneDay");
    const threeDays = fixtures.dateCases.find((item) => item.key === "threeDays");
    expect(oneDay).toMatchObject({ rentalDays: 1, subtotalSatang: 12_345, totalDueSatang: 312_345 });
    expect(threeDays).toMatchObject({ rentalDays: 3, subtotalSatang: 37_035, totalDueSatang: 337_035 });
    expect(fixtures.uploadPolicy.maxBytes).toBe(10 * 1024 * 1024);
    expect(fixtures.uploadPolicy.signedReadMaxSeconds).toBe(60);
  });

  it("keeps fixture values synthetic and free of credential/url material", () => {
    const serialized = JSON.stringify(fixtures);
    expect(serialized).toContain("synthetic-line-subject-a");
    expect(serialized).not.toMatch(/https?:\/\//i);
    expect(serialized).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./);
    expect(serialized).not.toMatch(/-----BEGIN [A-Z ]+PRIVATE KEY-----/);
  });
});

