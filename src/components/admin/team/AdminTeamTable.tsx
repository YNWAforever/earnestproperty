import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AdminTeamMember } from "@/lib/neon/admin-team.types";

import { AdminTeamStatusBadge, teamRoleLabel } from "./AdminTeamStatusBadge";

function memberName(member: AdminTeamMember) {
  return member.name?.trim() || "未命名成員";
}

function updatedAt(value: string) {
  return new Intl.DateTimeFormat("zh-HK", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function AdminTeamTable({
  members,
  selectedMemberId,
  onSelect,
}: {
  members: AdminTeamMember[];
  selectedMemberId: string | null;
  onSelect: (memberId: string) => void;
}) {
  return (
    <div className="hidden overflow-hidden rounded-lg border bg-card shadow-sm md:block">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">團隊成員目錄</caption>
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium" scope="col">
              成員
            </th>
            <th className="px-4 py-3 font-medium" scope="col">
              角色
            </th>
            <th className="px-4 py-3 font-medium" scope="col">
              存取狀態
            </th>
            <th className="px-4 py-3 font-medium" scope="col">
              邀請狀態
            </th>
            <th className="px-4 py-3 font-medium" scope="col">
              更新時間
            </th>
            <th className="px-4 py-3 text-right font-medium" scope="col">
              <span className="sr-only">檢視詳情</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {members.map((member) => {
            const selected = member.id === selectedMemberId;
            return (
              <tr
                aria-current={selected ? "true" : undefined}
                className={selected ? "bg-primary/5" : "hover:bg-muted/30"}
                key={member.id}
              >
                <td className="px-4 py-3">
                  <button
                    className="text-left font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onSelect(member.id)}
                    type="button"
                  >
                    {memberName(member)}
                  </button>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {member.email ?? "未提供電郵"}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {member.roles.map((role) => (
                      <span
                        className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary"
                        key={role}
                      >
                        {teamRoleLabel(role)}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <AdminTeamStatusBadge kind="access" value={member.accessState} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    <AdminTeamStatusBadge kind="invitation" value={member.invitationState} />
                    {member.needsAttention ? <AdminTeamStatusBadge kind="attention" value /> : null}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                  {updatedAt(member.updatedAt)}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    aria-label={`檢視 ${memberName(member)} 詳情`}
                    onClick={() => onSelect(member.id)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
