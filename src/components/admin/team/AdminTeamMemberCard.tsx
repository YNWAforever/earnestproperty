import { Ellipsis, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AdminTeamMember } from "@/lib/neon/admin-team.types";

import { AdminTeamStatusBadge, teamRoleLabel } from "./AdminTeamStatusBadge";

export function AdminTeamMemberCard({
  member,
  selected,
  canManage,
  onSelect,
}: {
  member: AdminTeamMember;
  selected: boolean;
  canManage: boolean;
  onSelect: (memberId: string) => void;
}) {
  const name = member.name?.trim() || "未命名成員";
  return (
    <article
      aria-current={selected ? "true" : undefined}
      className={`rounded-lg border bg-card p-4 shadow-sm ${selected ? "border-primary/40 ring-1 ring-primary/20" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{name}</h2>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {member.email ?? "未提供電郵"}
          </p>
        </div>
        <Button
          aria-label={canManage ? `更多操作：${name}` : `檢視 ${name} 詳情`}
          onClick={() => onSelect(member.id)}
          size="icon"
          type="button"
          variant="ghost"
        >
          {canManage ? <Ellipsis aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {member.roles.map((role) => (
          <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary" key={role}>
            {teamRoleLabel(role)}
          </span>
        ))}
        <AdminTeamStatusBadge kind="access" value={member.accessState} />
        <AdminTeamStatusBadge kind="invitation" value={member.invitationState} />
        {member.needsAttention ? <AdminTeamStatusBadge kind="attention" value /> : null}
      </div>
      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          更新於{" "}
          {new Intl.DateTimeFormat("zh-HK", { dateStyle: "medium", timeStyle: "short" }).format(
            new Date(member.updatedAt),
          )}
        </span>
        <Button onClick={() => onSelect(member.id)} size="sm" type="button" variant="outline">
          查看詳情
        </Button>
      </div>
    </article>
  );
}
