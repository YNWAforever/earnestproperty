import { useEffect, useState } from "react";
import { Activity, KeyRound, Mail, PauseCircle, RotateCcw, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AdminTeamMemberDetail } from "@/lib/neon/admin-team.types";
import type { StaffRole } from "@/lib/neon/auth.server";

import { AdminTeamStatusBadge, teamRoleLabel } from "./AdminTeamStatusBadge";

export type TeamMemberAction = "resend" | "roles" | "suspend" | "reactivate" | "reset";
export type TeamMemberActionOptions = { roles?: StaffRole[]; reassignToStaffId?: string | null };

export function AdminTeamDetailPanel({
  detail,
  canManage,
  currentUserEmail = null,
  successors = [],
  onAction,
}: {
  detail: AdminTeamMemberDetail;
  canManage: boolean;
  currentUserEmail?: string | null;
  successors?: Array<{ id: string; label: string }>;
  onAction: (action: TeamMemberAction, options?: TeamMemberActionOptions) => void;
}) {
  const { member } = detail;
  const name = member.name?.trim() || "未命名成員";
  const active = member.accessState === "active";
  const canResend = active && member.invitationState !== "none";
  const isSelfResetTarget = Boolean(
    member.email?.trim() &&
    currentUserEmail?.trim() &&
    member.email.trim().toLocaleLowerCase() === currentUserEmail.trim().toLocaleLowerCase(),
  );
  const canReset = active && detail.identity.authUserLinked && !isSelfResetTarget;
  const canSuspend = active;
  const canReactivate = !active && detail.identity.authUserLinked;
  const [roles, setRoles] = useState<StaffRole[]>(member.roles);
  const [successorId, setSuccessorId] = useState("");

  useEffect(() => {
    setRoles(member.roles);
    setSuccessorId("");
  }, [member.id, member.roles]);

  const toggleRole = (role: StaffRole) => {
    setRoles((current) =>
      current.includes(role) ? current.filter((item) => item !== role) : [...current, role],
    );
  };
  return (
    <div className="space-y-5">
      <section className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{member.email ?? "未提供電郵"}</p>
          </div>
          <div className="flex flex-wrap gap-1">
            <AdminTeamStatusBadge kind="access" value={member.accessState} />
            <AdminTeamStatusBadge kind="invitation" value={member.invitationState} />
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {detail.identity.authUserLinked ? "已連結帳戶身份" : "尚未連結帳戶身份"}
        </p>
      </section>
      <section aria-labelledby="team-roles-heading" className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 id="team-roles-heading" className="font-semibold">
            角色與存取
          </h3>
          {!canManage ? <span className="text-sm text-muted-foreground">唯讀</span> : null}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {(["admin", "manager", "agent"] as const).map((role) => (
            <div className="flex items-center gap-2" key={role}>
              <Checkbox
                aria-label={teamRoleLabel(role)}
                checked={roles.includes(role)}
                disabled={!canManage}
                id={`team-role-${role}`}
                onCheckedChange={() => toggleRole(role)}
              />
              <Label htmlFor={`team-role-${role}`}>{teamRoleLabel(role)}</Label>
            </div>
          ))}
        </div>
        {canManage ? (
          <Button
            className="mt-4"
            onClick={() => onAction("roles", { roles })}
            size="sm"
            type="button"
            variant="outline"
          >
            <ShieldCheck aria-hidden="true" />
            變更角色
          </Button>
        ) : null}
      </section>
      <section aria-labelledby="team-ownership-heading" className="rounded-lg border bg-card p-4">
        <h3 id="team-ownership-heading" className="font-semibold">
          工作擁有權
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          目前有 {detail.ownership.total} 項工作需要在停用前交接。
        </p>
        {active && canManage ? (
          <div className="mt-3 grid gap-1.5 text-sm">
            <Label htmlFor="team-successor">交接給</Label>
            <Select onValueChange={setSuccessorId} value={successorId}>
              <SelectTrigger aria-label="選擇工作交接人" id="team-successor">
                <SelectValue placeholder="請在確認前選擇成員" />
              </SelectTrigger>
              <SelectContent>
                {successors.map((successor) => (
                  <SelectItem key={successor.id} value={successor.id}>
                    {successor.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </section>
      <section aria-labelledby="team-activity-heading" className="rounded-lg border bg-card p-4">
        <h3 id="team-activity-heading" className="flex items-center gap-2 font-semibold">
          <Activity aria-hidden="true" className="h-4 w-4" />
          最近活動
        </h3>
        <ul className="mt-3 space-y-2 text-sm">
          {detail.recentActivity.length ? (
            detail.recentActivity.map((item) => (
              <li className="flex justify-between gap-3" key={item.id}>
                <span>
                  {item.action} · {item.outcome}
                </span>
                <time className="shrink-0 text-muted-foreground">
                  {new Intl.DateTimeFormat("zh-HK", { dateStyle: "medium" }).format(
                    new Date(item.createdAt),
                  )}
                </time>
              </li>
            ))
          ) : (
            <li className="text-muted-foreground">暫無可顯示的活動。</li>
          )}
        </ul>
      </section>
      {canManage ? (
        <section aria-labelledby="team-actions-heading" className="rounded-lg border bg-card p-4">
          <h3 id="team-actions-heading" className="font-semibold">
            帳戶操作
          </h3>
          <div className="mt-3 grid gap-2">
            {canResend ? (
              <Button onClick={() => onAction("resend")} type="button" variant="outline">
                <Mail aria-hidden="true" />
                重新發送邀請
              </Button>
            ) : null}
            {active ? (
              <>
                {isSelfResetTarget ? (
                  <p className="text-sm text-muted-foreground">
                    目前登入帳戶不能從這裡重設；如需重設自己的密碼，請在登入頁面使用「忘記密碼」。
                  </p>
                ) : null}
                {canReset ? (
                  <Button onClick={() => onAction("reset")} type="button" variant="outline">
                    <KeyRound aria-hidden="true" />
                    發送密碼重設連結
                  </Button>
                ) : null}
                {canSuspend ? (
                  <Button
                    disabled={detail.ownership.total > 0 && !successorId}
                    onClick={() => onAction("suspend", { reassignToStaffId: successorId || null })}
                    type="button"
                    variant="destructive"
                  >
                    <PauseCircle aria-hidden="true" />
                    停用帳戶
                  </Button>
                ) : null}
              </>
            ) : canReactivate ? (
              <Button onClick={() => onAction("reactivate")} type="button" variant="outline">
                <RotateCcw aria-hidden="true" />
                重新啟用帳戶
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
