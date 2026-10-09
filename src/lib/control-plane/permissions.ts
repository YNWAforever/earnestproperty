import type { StaffAccess, StaffRole } from "../neon/auth.server.ts";

export const controlPlanePermissions = [
  "ai.draft.generate",
  "ai.knowledge.rebuild",
  "campaign.queue",
  "cms.publish",
  "staff.manage",
  "system.health.read",
  "system.jobs.read",
  "system.jobs.retry",
  "system.jobs.cancel",
  "system.migrations.plan",
  "system.migrations.apply",
  "audit.read",
  // FX-17a G-11: staff ids, request ids, proposal reasons and provider evidence. Admin only.
  "system.diagnostics.read",
] as const;

export type ControlPlanePermission = (typeof controlPlanePermissions)[number];

const rolePermissions: Record<StaffRole, ReadonlySet<ControlPlanePermission>> = {
  agent: new Set(["ai.draft.generate", "system.health.read"]),
  manager: new Set([
    "ai.draft.generate",
    "ai.knowledge.rebuild",
    "campaign.queue",
    "cms.publish",
    "system.health.read",
    "system.jobs.read",
    "system.jobs.retry",
    "system.jobs.cancel",
    "audit.read",
  ]),
  admin: new Set(controlPlanePermissions),
  // Read-only reviewer: sees operations health and the audit log, cannot
  // mutate anything and cannot generate/publish content.
  viewer: new Set(["system.health.read", "audit.read"]),
};

export function hasPermission(roles: readonly string[], permission: ControlPlanePermission) {
  return roles.some((role) =>
    role === "admin" || role === "manager" || role === "agent" || role === "viewer"
      ? rolePermissions[role].has(permission)
      : false,
  );
}

/** Whether the server may send diagnostics (ids, provider evidence) to this actor. */
export function canReadDiagnostics(roles: readonly string[]): boolean {
  return hasPermission(roles, "system.diagnostics.read");
}

export async function requireStaffPermission(
  request: Request,
  permission: ControlPlanePermission,
): Promise<StaffAccess> {
  const { requireStaffAccess } = await import("../neon/auth.server.ts");
  const staff = await requireStaffAccess(request, ["admin", "manager", "agent", "viewer"]);
  if (!hasPermission(staff.roles, permission)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return staff;
}
