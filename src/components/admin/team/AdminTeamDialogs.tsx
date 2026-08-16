/* eslint-disable react-refresh/only-export-components */
import { useMemo } from "react";

import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AdminTeamMember } from "@/lib/neon/admin-team.types";

export type PendingTeamDialog = {
  action: "invite" | "resend" | "roles" | "suspend" | "reactivate" | "reset";
  member: Pick<AdminTeamMember, "name" | "email" | "roles">;
};

export function maskTeamEmail(email: string | null) {
  if (!email) return "未提供電郵";
  const [local, domain] = email.split("@");
  if (!local || !domain) return "已隱藏電郵";
  return `${local.slice(0, 1)}*****${local.slice(-1)}@${domain}`;
}

const copy = {
  invite: {
    title: "確認發送邀請",
    description: "確認後會向此成員發送帳戶邀請電郵。",
    label: "發送邀請",
  },
  resend: {
    title: "重新發送邀請",
    description: "確認後會再發送一封帳戶邀請電郵。",
    label: "重新發送邀請",
  },
  roles: {
    title: "確認變更角色",
    description: "角色會立即影響此成員在 Earnest 後台的權限。",
    label: "確認變更角色",
  },
  suspend: {
    title: "確認停用帳戶",
    description: "停用會立即移除 Earnest 存取權；既有工作必須先安全交接。",
    label: "停用帳戶",
  },
  reactivate: {
    title: "確認重新啟用帳戶",
    description: "重新啟用不會自動取回先前已交接的工作。",
    label: "重新啟用帳戶",
  },
  reset: {
    title: "發送密碼重設連結",
    description: "使用者會收到一次性電郵；Earnest 不會看到密碼，也不會設定或顯示密碼。",
    label: "發送重設連結",
  },
} as const;

export function teamDialogCopy(action: PendingTeamDialog["action"]) {
  return copy[action];
}

export function AdminTeamDialogs({
  pending,
  isPending,
  error,
  typedConfirmation = "",
  onTypedConfirmationChange,
  onOpenChange,
  onConfirm,
}: {
  pending: PendingTeamDialog | null;
  isPending: boolean;
  error: string | null;
  typedConfirmation?: string;
  onTypedConfirmationChange?: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const content = pending ? teamDialogCopy(pending.action) : null;
  const name = pending?.member.name?.trim() || "未命名成員";
  const needsExplicitConfirmation =
    pending?.action === "invite" ||
    (pending?.action === "roles" && pending.member.roles.includes("admin"));
  const disabled =
    needsExplicitConfirmation && typedConfirmation.trim().toUpperCase() !== "CONFIRM";
  const details = useMemo(
    () => (pending ? { name, email: maskTeamEmail(pending.member.email) } : null),
    [name, pending],
  );

  return (
    <AdminConfirmDialog
      confirmLabel={content?.label ?? "確認"}
      confirmVariant={pending?.action === "suspend" ? "destructive" : "default"}
      description={content?.description ?? ""}
      disabled={disabled}
      error={error}
      isPending={isPending}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      open={Boolean(pending)}
      title={content?.title ?? ""}
    >
      {details ? (
        <dl className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">成員</dt>
            <dd className="font-medium">{details.name}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">電郵</dt>
            <dd>{details.email}</dd>
          </div>
        </dl>
      ) : null}
      {needsExplicitConfirmation ? (
        <div className="space-y-2">
          <Label htmlFor="team-confirmation">輸入 CONFIRM 以繼續</Label>
          <Input
            id="team-confirmation"
            onChange={(event) => onTypedConfirmationChange?.(event.target.value)}
            value={typedConfirmation}
          />
        </div>
      ) : null}
    </AdminConfirmDialog>
  );
}
