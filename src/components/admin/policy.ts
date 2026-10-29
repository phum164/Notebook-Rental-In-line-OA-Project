import type { AdminRole, RentalStatus } from "@/types/domain";
import type { AdminPermission, RentalCommand } from "./adapters/types";

export type AdminRoute = "/admin" | "/admin/inventory" | "/admin/rentals" | "/admin/inspections" | "/admin/finance" | "/admin/settings" | "/admin/audit";

const rolePermissions: Record<AdminRole, readonly AdminPermission[]> = {
  VIEWER: ["rental:read", "audit:read"],
  REVIEWER: ["rental:read", "audit:read", "evidence:review", "rental:review"],
  OPERATIONS: ["rental:read", "audit:read", "inventory:write", "inspection:write", "finance:write"],
  OWNER: ["rental:read", "audit:read", "evidence:review", "rental:review", "inventory:write", "inspection:write", "finance:write", "settings:write"],
};

const routePermission: Partial<Record<AdminRoute, AdminPermission>> = {
  "/admin/inventory": "inventory:write",
  "/admin/inspections": "inspection:write",
  "/admin/finance": "finance:write",
  "/admin/settings": "settings:write",
  "/admin/audit": "audit:read",
  "/admin/rentals": "rental:read",
};

const commandRule: Record<RentalCommand, { status: RentalStatus; permission: AdminPermission }> = {
  approve: { status: "PENDING_REVIEW", permission: "rental:review" },
  reject: { status: "PENDING_REVIEW", permission: "rental:review" },
  "start-preparation": { status: "APPROVED", permission: "inspection:write" },
  "mark-ready": { status: "PREPARING", permission: "inspection:write" },
  handover: { status: "READY_FOR_HANDOVER", permission: "inspection:write" },
  "request-return": { status: "ACTIVE", permission: "inspection:write" },
  "receive-return": { status: "RETURN_PENDING", permission: "inspection:write" },
  "finalize-inspection": { status: "INSPECTION_PENDING", permission: "inspection:write" },
  "complete-settlement": { status: "REFUND_PENDING", permission: "finance:write" },
};

export function permissionsForRole(role: AdminRole): readonly AdminPermission[] { return rolePermissions[role]; }
export function hasPermission(role: AdminRole, permission: AdminPermission): boolean { return rolePermissions[role].includes(permission); }
export function canAccessRoute(role: AdminRole, route: AdminRoute): boolean {
  const permission = routePermission[route];
  return permission ? hasPermission(role, permission) : true;
}
export function visibleRoutes(role: AdminRole): readonly AdminRoute[] {
  return (["/admin", "/admin/inventory", "/admin/rentals", "/admin/inspections", "/admin/finance", "/admin/settings", "/admin/audit"] as const)
    .filter((route) => canAccessRoute(role, route));
}
export function routesForPermissions(permissions: readonly string[]): readonly AdminRoute[] {
  return (["/admin", "/admin/inventory", "/admin/rentals", "/admin/inspections", "/admin/finance", "/admin/settings", "/admin/audit"] as const)
    .filter((route) => !routePermission[route] || permissions.includes(routePermission[route]!));
}
export function allowedRentalCommands(role: AdminRole, status: RentalStatus): readonly RentalCommand[] {
  return (Object.entries(commandRule) as [RentalCommand, { status: RentalStatus; permission: AdminPermission }] [])
    .filter(([, rule]) => rule.status === status && hasPermission(role, rule.permission))
    .map(([command]) => command);
}
export function requiresRecentMfa(permission: AdminPermission): boolean {
  return permission === "finance:write" || permission === "settings:write";
}
