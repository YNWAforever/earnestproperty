import type { StaffAccess } from "../neon/auth.server.ts";
import { hasPermission, type ControlPlanePermission } from "./role-permissions.ts";

export {
  controlPlanePermissions,
  hasPermission,
  canReadDiagnostics,
  type ControlPlanePermission,
} from "./role-permissions.ts";

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
