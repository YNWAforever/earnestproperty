import type { AdminTeamList } from "@/lib/neon/admin-team.types";
import type { StaffRole } from "@/lib/neon/auth.server";

type LifecycleReply = {
  accepted: boolean;
  retryAfter: string | null;
  requestId: string;
  failureCode?: string;
};

export function createLatestRequestGuard() {
  let current = 0;

  return {
    begin: () => {
      current += 1;
      return current;
    },
    invalidate: () => {
      current += 1;
    },
    isCurrent: (request: number) => request === current,
  };
}

export function mergeAdminTeamPages(current: AdminTeamList, next: AdminTeamList): AdminTeamList {
  const members = [...current.members, ...next.members].filter(
    (member, index, all) => all.findIndex((candidate) => candidate.id === member.id) === index,
  );
  return { ...next, members };
}

export function resetAdminTeamPage<T extends { cursor?: string }>(search: T): Omit<T, "cursor"> {
  const { cursor: _cursor, ...firstPage } = search;
  return firstPage;
}

export function teamMutationFailure(value: unknown): string | null {
  if (
    value &&
    typeof value === "object" &&
    "invitationState" in value &&
    (value as { invitationState?: unknown }).invitationState === "failed"
  ) {
    const requestId = (value as { requestId?: unknown }).requestId;
    return `邀請未能發送，請稍後再試。${typeof requestId === "string" ? `參考編號：${requestId}` : ""}`;
  }
  if (
    value &&
    typeof value === "object" &&
    "accepted" in value &&
    !(value as LifecycleReply).accepted
  ) {
    const reply = value as LifecycleReply;
    if (reply.failureCode === "SELF_RESET_NOT_ALLOWED")
      return `目前登入帳戶不能從這裡重設；請在登入頁面使用「忘記密碼」。參考編號：${reply.requestId}`;
    if (reply.failureCode === "STAFF_IDENTITY_UNAVAILABLE")
      return `此成員沒有可用的已連結帳戶，未能發送重設連結。參考編號：${reply.requestId}`;
    if (reply.failureCode === "STAFF_ACTION_STORE_UNAVAILABLE")
      return `團隊資料暫時無法更新，請稍後再試。參考編號：${reply.requestId}`;
    const retry = reply.retryAfter
      ? `可於 ${new Intl.DateTimeFormat("zh-HK", { timeStyle: "short" }).format(new Date(reply.retryAfter))} 再試。`
      : "請稍後再試。";
    return `操作尚未完成。${retry}參考編號：${reply.requestId}`;
  }
  return null;
}

type TeamActionPayloadBase = {
  staffId: string;
  currentRoles: StaffRole[];
  proposedRoles?: StaffRole[];
  reassignToStaffId?: string | null;
};

export function teamActionPayload(input: TeamActionPayloadBase & { action: "roles" }): {
  staffId: string;
  roles: StaffRole[];
};
export function teamActionPayload(input: TeamActionPayloadBase & { action: "suspend" }): {
  staffId: string;
  active: false;
  reassignToStaffId: string | null;
};
export function teamActionPayload({
  action,
  staffId,
  currentRoles,
  proposedRoles,
  reassignToStaffId,
}: TeamActionPayloadBase & { action: "roles" | "suspend" }) {
  if (action === "roles") {
    return { staffId, roles: proposedRoles ?? currentRoles };
  }
  return { staffId, active: false, reassignToStaffId: reassignToStaffId ?? null };
}
