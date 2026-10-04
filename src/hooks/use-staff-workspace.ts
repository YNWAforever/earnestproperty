import { useCallback } from "react";
import { useWorkspaceCurrent } from "./use-workspace-current";
export { useWorkspaceCurrent } from "./use-workspace-current";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { staffSessionStore, useStaffSession } from "@/components/admin/staff-session";
import type { StaffSession } from "@/lib/neon/admin-data.types";

function workspaceIdentity(userId: string | null, session: StaffSession | null) {
  return userId && session?.status === "ok"
    ? JSON.stringify([userId, session.staffId, [...session.roles].sort()])
    : null;
}

/** Resolved membership, retaining the existing same-user answer during recheck. */
export function useStaffWorkspaceIdentity(roles?: readonly string[]) {
  const { user } = useNeonAuth();
  const { session } = useStaffSession(user?.id ?? null);
  if (roles && (session?.status !== "ok" || !session.roles.some((role) => roles.includes(role))))
    return null;
  return workspaceIdentity(user?.id ?? null, session);
}

export function useStaffWorkspaceCurrent(identity: string) {
  const check = useCallback(() => {
    const current = staffSessionStore.getSnapshot();
    return workspaceIdentity(current.userId, current.session) === identity;
  }, [identity]);
  return useWorkspaceCurrent(check);
}
