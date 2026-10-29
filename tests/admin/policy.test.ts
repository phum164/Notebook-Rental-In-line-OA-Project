import { describe, expect, it } from "vitest";
import { allowedRentalCommands, canAccessRoute, hasPermission, requiresRecentMfa, visibleRoutes } from "../../src/components/admin/policy";

describe("admin RBAC projection", () => {
  it("keeps viewer read-only and hides sensitive/workflow routes", () => {
    expect(visibleRoutes("VIEWER")).toEqual(["/admin", "/admin/rentals", "/admin/audit"]);
    expect(hasPermission("VIEWER", "evidence:review")).toBe(false);
    expect(canAccessRoute("VIEWER", "/admin/settings")).toBe(false);
  });
  it("separates reviewer from operations responsibilities", () => {
    expect(allowedRentalCommands("REVIEWER", "PENDING_REVIEW")).toEqual(["approve", "reject"]);
    expect(allowedRentalCommands("OPERATIONS", "PENDING_REVIEW")).toEqual([]);
    expect(canAccessRoute("REVIEWER", "/admin/inspections")).toBe(false);
    expect(canAccessRoute("OPERATIONS", "/admin/inspections")).toBe(true);
  });
  it("requires recent MFA for high-risk finance and settings work", () => {
    expect(requiresRecentMfa("finance:write")).toBe(true);
    expect(requiresRecentMfa("settings:write")).toBe(true);
    expect(requiresRecentMfa("inventory:write")).toBe(false);
  });
});

describe("rental command visibility", () => {
  it("only exposes commands matching the frozen state machine", () => {
    expect(allowedRentalCommands("OWNER", "PREPARING")).toEqual(["mark-ready"]);
    expect(allowedRentalCommands("OPERATIONS", "ACTIVE")).toEqual(["request-return"]);
    expect(allowedRentalCommands("OWNER", "INSPECTION_PENDING")).toEqual(["finalize-inspection"]);
    expect(allowedRentalCommands("OWNER", "COMPLETED")).toEqual([]);
  });
});
