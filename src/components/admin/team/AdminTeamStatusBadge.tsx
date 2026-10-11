/* eslint-disable react-refresh/only-export-components */
import { AlertTriangle, CheckCircle2, Clock3, Mail, PauseCircle, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { AdminTeamAccessState, AdminTeamInvitationState } from "@/lib/neon/admin-team.types";

const access = {
  active: {
    label: "已啟用",
    icon: CheckCircle2,
    className: "border-success/20 bg-success/10 text-success-foreground",
  },
  suspended: {
    label: "已停用",
    icon: PauseCircle,
    className: "border-muted-foreground/20 bg-muted-foreground/10 text-foreground/80",
  },
} as const;

const invitation = {
  none: {
    label: "未邀請",
    icon: Mail,
    className: "border-muted-foreground/20 bg-muted-foreground/10 text-foreground/80",
  },
  pending: {
    label: "處理中",
    icon: Clock3,
    className: "border-warning-accent/20 bg-warning-accent/10 text-warning-foreground",
  },
  sent: {
    label: "待人工分享",
    icon: CheckCircle2,
    className: "border-success/20 bg-success/10 text-success-foreground",
  },
  expired: {
    label: "邀請已過期",
    icon: AlertTriangle,
    className: "border-warning-accent/20 bg-warning-accent/10 text-warning-foreground",
  },
  failed: {
    label: "邀請失敗",
    icon: XCircle,
    className: "border-destructive/20 bg-destructive/5 text-destructive",
  },
} as const;

const roleLabels = {
  admin: "管理員",
  manager: "主管",
  agent: "經紀",
  // Read-only reviewer role. Deliberately not "唯讀" -- that string already
  // means "this panel is read-only for you" elsewhere in AdminTeamDetailPanel.
  viewer: "檢視者",
} as const;

export function teamRoleLabel(role: keyof typeof roleLabels) {
  return roleLabels[role];
}

export function AdminTeamStatusBadge({
  kind,
  value,
}: {
  kind: "access" | "invitation" | "attention";
  value: AdminTeamAccessState | AdminTeamInvitationState | boolean;
}) {
  const item =
    kind === "access"
      ? access[value as AdminTeamAccessState]
      : kind === "invitation"
        ? invitation[value as AdminTeamInvitationState]
        : value
          ? {
              label: "需要跟進",
              icon: AlertTriangle,
              className: "border-warning-accent/20 bg-warning-accent/10 text-warning-foreground",
            }
          : null;
  if (!item) return null;
  const Icon = item.icon;

  return (
    <Badge className={`gap-1 font-medium ${item.className}`} variant="outline">
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {item.label}
    </Badge>
  );
}
