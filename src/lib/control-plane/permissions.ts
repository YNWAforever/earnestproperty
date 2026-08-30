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
  "transaction.verify",
  "transaction.publish",
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
    "transaction.verify",
    "transaction.publish",
  ]),
  admin: new Set(controlPlanePermissions),
};

export function hasPermission(roles: readonly string[], permission: ControlPlanePermission) {
  return roles.some((role) =>
    role === "admin" || role === "manager" || role === "agent"
      ? rolePermissions[role].has(permission)
      : false,
  );
}

export async function requireStaffPermission(
  request: Request,
  permission: ControlPlanePermission,
): Promise<StaffAccess> {
  const { requireStaffAccess } = await import("../neon/auth.server.ts");
  const staff = await requireStaffAccess(request, ["admin", "manager", "agent"]);
  if (!hasPermission(staff.roles, permission)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return staff;
}
