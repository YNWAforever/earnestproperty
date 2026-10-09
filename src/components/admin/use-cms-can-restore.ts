import { useNeonAuth } from "@/hooks/use-neon-auth";
import { useStaffSession } from "@/components/admin/staff-session";

/** Roles the server lets restore a CMS version (`restoreAdminCmsRevision` and `cms_mutate`). */
export const CMS_RESTORE_ROLES = ["admin", "manager"] as const;

/**
 * Whether the signed-in staff member may 還原 a CMS version.
 *
 * UI only: the server already refuses restore for every other role. While the session is
 * still loading this is false, so an agent never sees a button that would only fail.
 */
export function useCmsCanRestore(): boolean {
  const { user } = useNeonAuth();
  const { session } = useStaffSession(user?.id ?? null);
  return (
    session?.status === "ok" &&
    session.roles.some((role) => (CMS_RESTORE_ROLES as readonly string[]).includes(role))
  );
}
