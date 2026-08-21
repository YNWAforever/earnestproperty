import { describe, expect, test } from "bun:test";
import { load } from "cheerio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AdminTeamDetailPanel } from "./AdminTeamDetailPanel";
import { maskTeamEmail, teamDialogCopy } from "./AdminTeamDialogs";
import { AdminTeamMemberCard } from "./AdminTeamMemberCard";
import { AdminTeamStatusBadge } from "./AdminTeamStatusBadge";
import { AdminTeamTable } from "./AdminTeamTable";
import {
  createLatestRequestGuard,
  mergeAdminTeamPages,
  resetAdminTeamPage,
  serverErrorStatus,
  teamActionPayload,
  teamMutationFailure,
} from "./admin-team-route-utils";
import type { AdminTeamMember, AdminTeamMemberDetail } from "@/lib/neon/admin-team.types";

const member: AdminTeamMember = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "陳大文",
  email: "tai.man@example.com",
  roles: ["agent"],
  accessState: "active" as const,
  invitationState: "sent" as const,
  invitationRetryAfter: null,
  invitationExpiresAt: null,
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T01:00:00.000Z",
  needsAttention: false,
};

const detail: AdminTeamMemberDetail = {
  member,
  identity: { authUserLinked: true },
  ownership: { counts: { inquiries: 2 }, total: 2 },
  latestOperation: {
    action: "invite",
    state: "succeeded",
    safeErrorCode: null,
    retryAfter: null,
  },
  recentActivity: [
    { id: "activity-1", action: "staff.invited", outcome: "success", createdAt: member.updatedAt },
  ],
  version: "2026-08-16T01:00:00.000Z",
};

function render(element: React.ReactElement) {
  return load(renderToStaticMarkup(element));
}

describe("Admin Team responsive directory", () => {
  test("desktop table and mobile card retain the same readable member fields", () => {
    const table = render(
      createElement(AdminTeamTable, {
        members: [member],
        selectedMemberId: member.id,
        onSelect: () => undefined,
      }),
    );
    const card = render(
      createElement(AdminTeamMemberCard, {
        member,
        selected: true,
        canManage: true,
        onSelect: () => undefined,
      }),
    );

    expect(table("caption.sr-only").text()).toContain("團隊成員");
    expect(table("th[scope='col']")).toHaveLength(6);
    expect(table("tr[aria-current='true']")).toHaveLength(1);
    expect(card("[aria-current='true']")).toHaveLength(1);
    expect(card("button[aria-label='更多操作：陳大文']")).toHaveLength(1);
    expect(card.text()).toContain(
      new Intl.DateTimeFormat("zh-HK", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(member.updatedAt),
      ),
    );

    for (const value of ["陳大文", "tai.man@example.com", "經紀", "已啟用", "已邀請"]) {
      expect(table.text()).toContain(value);
      expect(card.text()).toContain(value);
    }
  });

  test("status badges pair text with semantic labels instead of color only", () => {
    const $ = render(
      createElement(
        "div",
        null,
        createElement(AdminTeamStatusBadge, { kind: "access", value: "active" }),
        createElement(AdminTeamStatusBadge, { kind: "invitation", value: "failed" }),
        createElement(AdminTeamStatusBadge, { kind: "attention", value: true }),
      ),
    );

    expect($.text()).toContain("已啟用");
    expect($.text()).toContain("邀請失敗");
    expect($.text()).toContain("需要跟進");
  });
});

describe("Admin Team role-aware detail and confirmations", () => {
  test("Admin sees only permitted lifecycle controls while Manager stays read-only", () => {
    const admin = render(
      createElement(AdminTeamDetailPanel, {
        detail,
        canManage: true,
        onAction: () => undefined,
      }),
    );
    const manager = render(
      createElement(AdminTeamDetailPanel, {
        detail,
        canManage: false,
        onAction: () => undefined,
      }),
    );

    for (const label of ["更新邀請", "變更角色", "停用帳戶", "發送密碼重設連結"]) {
      expect(admin.text()).toContain(label);
      expect(manager.text()).not.toContain(label);
    }
    expect(manager.text()).toContain("唯讀");
  });

  test("Admin membership confirmation covers both promotion and demotion", () => {
    expect(teamDialogCopy("roles", ["agent"], ["admin", "agent"]).requiresConfirmation).toBe(true);
    expect(teamDialogCopy("roles", ["admin", "agent"], ["agent"]).requiresConfirmation).toBe(true);
    expect(teamDialogCopy("roles", ["manager"], ["agent"]).requiresConfirmation).toBe(false);
  });

  test("confirmation copy identifies the member and keeps password recovery provider-owned", () => {
    const reset = teamDialogCopy("reset");

    expect(maskTeamEmail(member.email)).toBe("t*****n@example.com");
    expect(member.name).toBe("陳大文");
    expect(reset.description).toContain("一次性電郵");
    expect(reset.description).toContain("Earnest 不會看到密碼");
  });

  test("suspended accounts expose Reactivate rather than active-only actions", () => {
    const suspendedDetail = { ...detail, member: { ...member, accessState: "suspended" as const } };
    const $ = render(
      createElement(AdminTeamDetailPanel, {
        detail: suspendedDetail,
        canManage: true,
        onAction: () => undefined,
      }),
    );

    expect($.text()).toContain("重新啟用帳戶");
    expect($.text()).not.toContain("發送密碼重設連結");
  });

  test("does not offer self password reset and explains the recovery path", () => {
    const $ = render(
      createElement(AdminTeamDetailPanel, {
        currentUserEmail: member.email,
        detail,
        canManage: true,
        onAction: () => undefined,
      }),
    );

    expect($.text()).not.toContain("發送密碼重設連結");
    expect($.text()).toContain("登入頁面");
  });
});

describe("Admin Team request safety", () => {
  test("latest detail selection wins and invalidation suppresses late responses", () => {
    const guard = createLatestRequestGuard();
    const first = guard.begin();
    const second = guard.begin();

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
    guard.invalidate();
    expect(guard.isCurrent(second)).toBe(false);
  });

  test("keyset page merge appends unique members while preserving current counts", () => {
    const next = { ...member, id: "22222222-2222-4222-8222-222222222222", name: "李小明" };
    const merged = mergeAdminTeamPages(
      {
        members: [member],
        counts: { active: 1, invited: 0, suspended: 0, attention: 0 },
        nextCursor: "old",
      },
      {
        members: [member, next],
        counts: { active: 2, invited: 0, suspended: 0, attention: 0 },
        nextCursor: "new",
      },
    );

    expect(merged.members.map((item) => item.id)).toEqual([member.id, next.id]);
    expect(merged.counts.active).toBe(2);
    expect(merged.nextCursor).toBe("new");
  });

  test("mutation refresh resets to page one while retaining the selected member link", () => {
    expect(
      resetAdminTeamPage({
        q: "陳",
        role: "agent",
        cursor: "next-page",
        member: member.id,
      }),
    ).toEqual({ q: "陳", role: "agent", member: member.id });
  });

  test("failed invitations and cooldowns stay in their dialog with safe recovery text", () => {
    expect(teamMutationFailure({ invitationState: "failed", requestId: "request-1" })).toContain(
      "邀請未能建立",
    );
    expect(
      teamMutationFailure({
        accepted: false,
        retryAfter: "2026-08-16T10:00:00.000Z",
        requestId: "request-2",
      }),
    ).toContain("可於");
    expect(
      teamMutationFailure({ accepted: true, retryAfter: null, requestId: "request-3" }),
    ).toBeNull();
  });

  test("structured reset failures explain the safe recovery path", () => {
    expect(
      teamMutationFailure({
        accepted: false,
        retryAfter: null,
        requestId: "request-self",
        failureCode: "SELF_RESET_NOT_ALLOWED",
      }),
    ).toContain("登入頁面");
    expect(
      teamMutationFailure({
        accepted: false,
        retryAfter: null,
        requestId: "request-store",
        failureCode: "STAFF_ACTION_STORE_UNAVAILABLE",
      }),
    ).toContain("團隊資料");
  });

  test("server error statuses survive the server-function boundary as plain Errors", () => {
    // TanStack Start does not preserve a thrown Response across the RPC boundary:
    // the client receives `new Error(<response body text>)`. Recovering the status
    // from that body is the only way the UI can tell an expired login from a
    // permission problem from a write conflict.
    expect(serverErrorStatus(new Error("Unauthorized"))).toBe(401);
    expect(serverErrorStatus(new Error("Forbidden"))).toBe(403);
    expect(serverErrorStatus(new Error("Team member not found."))).toBe(404);
    expect(serverErrorStatus(new Error("Staff member not found."))).toBe(404);
    expect(
      serverErrorStatus(
        new Error(
          "This change conflicted with another concurrent staff-access update. Please retry.",
        ),
      ),
    ).toBe(409);

    // A real Response still works, for direct/SSR invocations.
    expect(serverErrorStatus(new Response("Forbidden", { status: 403 }))).toBe(403);

    // Anything unrecognised must stay null so the caller falls back honestly
    // rather than mislabelling an unknown failure.
    expect(serverErrorStatus(new Error("some unmapped provider text"))).toBeNull();
    expect(serverErrorStatus("not an error")).toBeNull();
    expect(serverErrorStatus(undefined)).toBeNull();
  });

  test("role and successor confirmations retain the selected payload", () => {
    expect(
      teamActionPayload({
        action: "roles",
        staffId: member.id,
        currentRoles: ["agent"],
        proposedRoles: ["admin", "manager"],
      }),
    ).toEqual({ staffId: member.id, roles: ["admin", "manager"] });
    expect(
      teamActionPayload({
        action: "suspend",
        staffId: member.id,
        currentRoles: ["agent"],
        reassignToStaffId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toEqual({
      staffId: member.id,
      active: false,
      reassignToStaffId: "22222222-2222-4222-8222-222222222222",
    });
  });
});
