import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AdminDetailPanel } from "@/components/admin/AdminDetailPanel";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import {
  AdminTeamDetailPanel,
  type TeamMemberAction,
  type TeamMemberActionOptions,
} from "@/components/admin/team/AdminTeamDetailPanel";
import { AdminTeamDialogs, type PendingTeamDialog } from "@/components/admin/team/AdminTeamDialogs";
import { AdminTeamFilters, type TeamFilters } from "@/components/admin/team/AdminTeamFilters";
import { AdminTeamMemberCard } from "@/components/admin/team/AdminTeamMemberCard";
import { AdminTeamTable } from "@/components/admin/team/AdminTeamTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import {
  changeStaffActive,
  changeStaffRoles,
  getAdminTeamMember,
  inviteStaffMember,
  listAdminTeam,
  resendStaffInvitation,
  sendStaffPasswordReset,
} from "@/lib/neon/admin-team";
import type { AdminTeamList, AdminTeamMemberDetail } from "@/lib/neon/admin-team.types";
import type { StaffRole } from "@/lib/neon/auth.server";

type TeamSearch = {
  q?: string;
  role?: StaffRole;
  state?: "active" | "suspended" | "invited" | "attention";
  cursor?: string;
};
type LifecycleReply = { accepted: boolean; retryAfter: string | null; requestId: string };
const emptyTeam: AdminTeamList = {
  members: [],
  counts: { active: 0, invited: 0, suspended: 0, attention: 0 },
  nextCursor: null,
};

function parseTeamSearch(search: Record<string, unknown>): TeamSearch {
  const result: TeamSearch = {};
  if (typeof search.q === "string" && search.q.trim()) result.q = search.q.trim();
  if (["admin", "manager", "agent"].includes(String(search.role)))
    result.role = search.role as StaffRole;
  if (["active", "suspended", "invited", "attention"].includes(String(search.state)))
    result.state = search.state as TeamSearch["state"];
  if (typeof search.cursor === "string" && search.cursor.trim()) result.cursor = search.cursor;
  return result;
}

export const Route = createFileRoute("/admin/team")({
  validateSearch: parseTeamSearch,
  head: () => ({
    meta: [{ title: "團隊成員 | Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminTeam,
});

function safeError(error: unknown) {
  if (error instanceof Response) {
    if (error.status === 401) return "登入狀態已過期，請重新登入。";
    if (error.status === 403) return "你沒有管理團隊成員的權限。";
    if (error.status === 404) return "此成員已不存在，目錄已重新整理。";
    if (error.status === 409) return "資料已被其他管理員更新，請重新確認。";
    if (error.status === 429) return "操作正在冷卻中，請於可重試時間後再試。";
  }
  return "暫時無法更新團隊資料，請稍後再試。";
}

function isLifecycleReply(value: unknown): value is LifecycleReply {
  return Boolean(value) && typeof value === "object" && "accepted" in value && "requestId" in value;
}

function AdminTeam() {
  const { user } = useNeonAuth();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const filters = useMemo<TeamFilters>(
    () => ({ q: search.q ?? "", role: search.role, state: search.state }),
    [search],
  );
  const [queryDraft, setQueryDraft] = useState(filters.q);
  const [team, setTeam] = useState<AdminTeamList | null>(null);
  const [detail, setDetail] = useState<AdminTeamMemberDetail | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [pending, setPending] = useState<PendingTeamDialog | null>(null);
  const [pendingOptions, setPendingOptions] = useState<TeamMemberActionOptions>({});
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [mutating, setMutating] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoles, setInviteRoles] = useState<StaffRole[]>(["agent"]);
  const requestRef = useRef(0);
  const teamRef = useRef<AdminTeamList | null>(null);

  const replaceSearch = useCallback(
    (next: TeamSearch) => {
      void navigate({ search: parseTeamSearch(next), replace: true, resetScroll: false });
    },
    [navigate],
  );

  const loadTeam = useCallback(async () => {
    if (!user) return;
    const request = requestRef.current + 1;
    requestRef.current = request;
    setLoading(true);
    try {
      const [nextTeam, selfResult] = await Promise.all([
        listAdminTeam({
          data: { q: search.q, role: search.role, state: search.state, cursor: search.cursor },
        }),
        user.email
          ? listAdminTeam({ data: { q: user.email, limit: 1 } })
          : Promise.resolve(emptyTeam),
      ]);
      if (request !== requestRef.current) return;
      setTeam(nextTeam);
      teamRef.current = nextTeam;
      setCanManage(Boolean(selfResult.members[0]?.roles.includes("admin")));
      setError(null);
      setStale(false);
      setForbidden(false);
    } catch (reason) {
      if (request !== requestRef.current) return;
      if (reason instanceof Response && reason.status === 403) {
        setForbidden(true);
        setTeam(null);
        teamRef.current = null;
        setDetail(null);
        setSelectedMemberId(null);
      } else {
        setError(safeError(reason));
        setStale(Boolean(teamRef.current));
      }
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [search.cursor, search.q, search.role, search.state, user]);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);
  useEffect(() => {
    setQueryDraft(filters.q);
  }, [filters.q]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (queryDraft.trim() !== filters.q)
        replaceSearch({ ...search, q: queryDraft.trim() || undefined, cursor: undefined });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filters.q, queryDraft, replaceSearch, search]);

  const loadDetail = useCallback(
    async (staffId: string) => {
      setSelectedMemberId(staffId);
      setDetailLoading(true);
      try {
        const nextDetail = await getAdminTeamMember({ data: { staffId } });
        setDetail(nextDetail);
        setError(null);
      } catch (reason) {
        if (reason instanceof Response && reason.status === 404) {
          setSelectedMemberId(null);
          setDetail(null);
          void loadTeam();
        }
        setError(safeError(reason));
      } finally {
        setDetailLoading(false);
      }
    },
    [loadTeam],
  );

  const refreshAll = useCallback(async () => {
    await loadTeam();
    if (selectedMemberId) await loadDetail(selectedMemberId);
  }, [loadDetail, loadTeam, selectedMemberId]);

  const toggleInviteRole = (role: StaffRole) =>
    setInviteRoles((roles) =>
      roles.includes(role) ? roles.filter((item) => item !== role) : [...roles, role],
    );
  const openInvite = () => {
    setInviteOpen(true);
    setConfirmError(null);
  };
  const beginInviteConfirmation = () => {
    if (!inviteEmail.trim() || !inviteRoles.length) {
      setConfirmError("請提供有效電郵並選擇至少一個角色。");
      return;
    }
    setPending({
      action: "invite",
      member: { name: inviteName, email: inviteEmail, roles: inviteRoles },
    });
    setConfirmError(null);
  };

  const beginAction = (action: TeamMemberAction, options: TeamMemberActionOptions = {}) => {
    if (!detail) return;
    if (action === "suspend" && detail.ownership.total > 0 && !options.reassignToStaffId) {
      setError("請先選擇工作交接人，才可停用此帳戶。");
      return;
    }
    setPending({
      action,
      member: { ...detail.member, roles: options.roles ?? detail.member.roles },
    });
    setPendingOptions(options);
    setConfirmError(null);
    setConfirmText("");
  };

  const closeConfirmation = (open: boolean) => {
    if (!open) {
      setPending(null);
      setConfirmError(null);
      setConfirmText("");
      setPendingOptions({});
    }
  };

  const confirm = async () => {
    if (!pending) return;
    setMutating(true);
    try {
      let result: unknown;
      if (pending.action === "invite") {
        result = await inviteStaffMember({
          data: { name: inviteName.trim() || null, email: inviteEmail.trim(), roles: inviteRoles },
        });
        setInviteOpen(false);
        setInviteName("");
        setInviteEmail("");
        setInviteRoles(["agent"]);
      } else if (!detail) return;
      else if (pending.action === "resend")
        result = await resendStaffInvitation({ data: { staffId: detail.member.id } });
      else if (pending.action === "reset")
        result = await sendStaffPasswordReset({ data: { staffId: detail.member.id } });
      else if (pending.action === "roles")
        result = await changeStaffRoles({
          data: { staffId: detail.member.id, roles: pendingOptions.roles ?? detail.member.roles },
        });
      else if (pending.action === "suspend")
        result = await changeStaffActive({
          data: {
            staffId: detail.member.id,
            active: false,
            reassignToStaffId: pendingOptions.reassignToStaffId ?? null,
          },
        });
      else if (pending.action === "reactivate")
        result = await changeStaffActive({ data: { staffId: detail.member.id, active: true } });
      if (isLifecycleReply(result) && !result.accepted) {
        const retry = result.retryAfter
          ? `可於 ${new Intl.DateTimeFormat("zh-HK", { timeStyle: "short" }).format(new Date(result.retryAfter))} 再試。`
          : "請稍後再試。";
        setConfirmError(`操作尚未完成。${retry} 參考編號：${result.requestId}`);
        return;
      }
      toast.success("團隊資料已更新。");
      closeConfirmation(false);
      await refreshAll();
    } catch (reason) {
      if (reason instanceof Response && reason.status === 409) {
        closeConfirmation(false);
        if (selectedMemberId) await loadDetail(selectedMemberId);
      } else {
        setConfirmError(safeError(reason));
      }
    } finally {
      setMutating(false);
    }
  };

  if (forbidden)
    return (
      <AdminShell title="團隊成員" description="管理 Earnest 後台存取權。">
        <AdminError message="你沒有檢視團隊成員的權限。" />
      </AdminShell>
    );
  const directory = team ?? emptyTeam;

  return (
    <AdminShell
      title="團隊成員"
      description="搜尋、檢視並安全管理帳戶存取權。"
      actions={
        canManage ? (
          <Button onClick={openInvite} type="button">
            <Plus aria-hidden="true" />
            邀請成員
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <AdminTeamFilters
          filters={filters}
          onChange={(change) => replaceSearch({ ...search, ...change, cursor: undefined })}
          onClear={() => replaceSearch({})}
          onQueryDraftChange={setQueryDraft}
          queryDraft={queryDraft}
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              ["已啟用", directory.counts.active],
              ["已邀請", directory.counts.invited],
              ["已停用", directory.counts.suspended],
              ["需要跟進", directory.counts.attention],
            ] as const
          ).map(([label, count]) => (
            <div className="rounded-lg border bg-card p-3" key={label}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-semibold">{count}</p>
            </div>
          ))}
        </div>
        {error ? (
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            role="alert"
          >
            <span>
              {stale ? "顯示上次成功資料：" : ""}
              {error}
            </span>
            <Button onClick={() => void loadTeam()} size="sm" type="button" variant="outline">
              <RefreshCw aria-hidden="true" />
              重試
            </Button>
          </div>
        ) : null}
        {loading && !team ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : directory.members.length ? (
          <>
            <AdminTeamTable
              members={directory.members}
              onSelect={(id) => void loadDetail(id)}
              selectedMemberId={selectedMemberId}
            />
            <div className="grid gap-3 md:hidden">
              {directory.members.map((member) => (
                <AdminTeamMemberCard
                  canManage={canManage}
                  key={member.id}
                  member={member}
                  onSelect={(id) => void loadDetail(id)}
                  selected={member.id === selectedMemberId}
                />
              ))}
            </div>
            {directory.nextCursor ? (
              <div className="flex justify-center">
                <Button
                  disabled={loading}
                  onClick={() => replaceSearch({ ...search, cursor: directory.nextCursor })}
                  type="button"
                  variant="outline"
                >
                  載入更多成員
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <AdminEmptyState
            title="找不到團隊成員"
            description="調整搜尋或篩選條件，或在你有權限時邀請新成員。"
          />
        )}
      </div>
      <AdminDetailPanel
        description="帳戶身份、存取權與安全活動。"
        onOpenChange={(open) => {
          if (!open) {
            setSelectedMemberId(null);
            setDetail(null);
          }
        }}
        open={Boolean(selectedMemberId)}
        title={detail?.member.name ?? "成員詳情"}
      >
        {detailLoading && !detail ? (
          <Skeleton className="h-72 w-full" />
        ) : detail ? (
          <AdminTeamDetailPanel
            canManage={canManage}
            detail={detail}
            onAction={beginAction}
            successors={directory.members
              .filter((member) => member.id !== detail.member.id && member.accessState === "active")
              .map((member) => ({
                id: member.id,
                label: member.name?.trim() || member.email || "未命名成員",
              }))}
          />
        ) : null}
      </AdminDetailPanel>
      {canManage && inviteOpen ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/50 p-4">
          <div
            aria-modal="true"
            className="w-full max-w-lg rounded-lg bg-background p-5 shadow-xl"
            role="dialog"
          >
            <h2 className="text-lg font-semibold">邀請成員</h2>
            <div className="mt-4 grid gap-3">
              <label>
                <span className="mb-1 block text-sm font-medium">姓名</span>
                <Input onChange={(event) => setInviteName(event.target.value)} value={inviteName} />
              </label>
              <label>
                <span className="mb-1 block text-sm font-medium">電郵</span>
                <Input
                  onChange={(event) => setInviteEmail(event.target.value)}
                  type="email"
                  value={inviteEmail}
                />
              </label>
              <fieldset>
                <legend className="text-sm font-medium">角色</legend>
                <div className="mt-2 flex flex-wrap gap-3">
                  {(["admin", "manager", "agent"] as StaffRole[]).map((role) => (
                    <label className="flex items-center gap-2" key={role}>
                      <Checkbox
                        checked={inviteRoles.includes(role)}
                        onCheckedChange={() => toggleInviteRole(role)}
                      />
                      {role === "admin" ? "管理員" : role === "manager" ? "主管" : "經紀"}
                    </label>
                  ))}
                </div>
              </fieldset>
              {confirmError ? (
                <p className="text-sm text-destructive" role="alert">
                  {confirmError}
                </p>
              ) : null}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setInviteOpen(false)} type="button" variant="outline">
                取消
              </Button>
              <Button onClick={beginInviteConfirmation} type="button">
                下一步
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <AdminTeamDialogs
        error={confirmError}
        isPending={mutating}
        onConfirm={() => void confirm()}
        onOpenChange={closeConfirmation}
        onTypedConfirmationChange={setConfirmText}
        pending={pending}
        typedConfirmation={confirmText}
      />
    </AdminShell>
  );
}
