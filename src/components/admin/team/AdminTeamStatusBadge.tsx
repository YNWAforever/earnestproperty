/* eslint-disable react-refresh/only-export-components */
import { AlertTriangle, CheckCircle2, Clock3, Mail, PauseCircle, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { AdminTeamAccessState, AdminTeamInvitationState } from "@/lib/neon/admin-team.types";

const access = {
  active: {
    label: "已啟用",
    icon: CheckCircle2,
    className: "border-emerald-700/20 bg-emerald-700/10 text-emerald-800",
  },
  suspended: {
    label: "已停用",
    icon: PauseCircle,
    className: "border-slate-500/20 bg-slate-500/10 text-slate-700",
  },
} as const;

const invitation = {
  none: {
    label: "未邀請",
    icon: Mail,
    className: "border-slate-500/20 bg-slate-500/10 text-slate-700",
  },
  pending: {
    label: "處理中",
    icon: Clock3,
    className: "border-amber-700/20 bg-amber-700/10 text-amber-900",
  },
  sent: {
    label: "已發送",
    icon: CheckCircle2,
    className: "border-emerald-700/20 bg-emerald-700/10 text-emerald-800",
  },
  expired: {
    label: "邀請已過期",
    icon: AlertTriangle,
    className: "border-amber-700/20 bg-amber-700/10 text-amber-900",
  },
  failed: {
    label: "發送失敗",
    icon: XCircle,
    className: "border-destructive/20 bg-destructive/10 text-destructive",
  },
} as const;

const roleLabels = { admin: "管理員", manager: "主管", agent: "經紀" } as const;

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
              className: "border-amber-700/20 bg-amber-700/10 text-amber-900",
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
