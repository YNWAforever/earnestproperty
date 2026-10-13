import type { ComponentType } from "react";
import { useStaffWorkspaceIdentity } from "@/hooks/use-staff-workspace";
import { AdminShell } from "./AdminShell";

/** Own the route state above the Shell, so a changed membership discards it. */
export function AdminStaffWorkspace({
  component: Workspace,
  title,
  roles,
  contentWidth = "standard",
}: {
  component: ComponentType<{ identity: string }>;
  title: string;
  roles: readonly string[];
  contentWidth?: "standard" | "form" | "wide";
}) {
  const identity = useStaffWorkspaceIdentity(roles);
  if (!identity) {
    return (
      <AdminShell
        title={title}
        description="請選擇你獲授權的後台工作。"
        contentWidth={contentWidth}
      >
        <p role="status">目前沒有此頁的存取權限，請從後台選單選擇可用工作。</p>
      </AdminShell>
    );
  }
  return <Workspace key={identity} identity={identity} />;
}
