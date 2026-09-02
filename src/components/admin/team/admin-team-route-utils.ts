import type { AdminTeamList } from "@/lib/neon/admin-team.types";
import type { StaffRole } from "@/lib/neon/auth.server";

type LifecycleReply = {
  accepted: boolean;
  retryAfter: string | null;
  requestId: string;
  failureCode?: string;
};

/**
 * Legacy fallback: exact response bodies thrown by the admin server
 * functions, mapped to their status. Kept only for an error that predates
 * ServerFnResponseError or reaches this function some other way; every
 * current call from admin.team.tsx already carries `.status` (see below).
 * Must stay in sync with the `throw new Response(...)` sites in
 * lib/neon/auth.server.ts (requireStaffAccess), lib/neon/staff-lifecycle.server.ts,
 * lib/neon/admin-team.server.ts and lib/neon/admin-data.server.ts.
 *
 * Only statuses the UI meaningfully distinguishes are listed. An unrecognised
 * body must stay unmapped so callers report an honest generic failure instead of
 * mislabelling it.
 */
const SERVER_ERROR_BODY_STATUS = new Map<string, number>([
  ["Unauthorized", 401],
  ["Forbidden", 403],
  ["Staff member not found.", 404],
  ["Team member not found.", 404],
  ["This change conflicted with another concurrent staff-access update. Please retry.", 409],
  ["staff-email-unverified", 403],
  ["account-not-found", 404],
  ["already-linked", 409],
  ["account-already-linked", 409],
]);

/**
 * Recover the HTTP status behind a failed admin call.
 *
 * A server-thrown `Response` does NOT survive as a rejection at the raw
 * TanStack Start layer -- it RESOLVES. Confirmed live against a running dev
 * server (real DB, real Neon Auth, real Vite-built client/server split, not
 * just source reading): an unauthenticated call resolved with a raw
 * `Response(401)` object instead of throwing. Full traced mechanism is in
 * lib/neon/server-fn-response.ts's doc comment.
 *
 * `error instanceof Response` never matches here specifically because
 * lib/neon/admin-team.ts's exported wrappers (listAdminTeam,
 * sendStaffPasswordReset, etc.) already convert that resolved Response into a
 * REJECTED `ServerFnResponseError` via `unwrapServerFnResponse` before this
 * component ever awaits them -- so by the time a catch block here runs,
 * `.status` is already a reliable property on the caught error. The body-text
 * map below is a fallback for anything that reaches this function without
 * going through that unwrap.
 */
export function serverErrorStatus(error: unknown): number | null {
  if (error instanceof Response) return error.status;
  // ServerFnResponseError carries the real status from the unwrapped Response.
  // Preferred over the body map below, which matches prose that can drift.
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number" && Number.isFinite(status)) return status;
  }
  if (error instanceof Error) return SERVER_ERROR_BODY_STATUS.get(error.message.trim()) ?? null;
  return null;
}

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
    return `邀請未能建立，請稍後再試。${typeof requestId === "string" ? `參考編號：${requestId}` : ""}`;
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
