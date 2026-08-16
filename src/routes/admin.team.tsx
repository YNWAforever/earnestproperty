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
import {
  createLatestRequestGuard,
  mergeAdminTeamPages,
  resetAdminTeamPage,
  teamActionPayload,
  teamMutationFailure,
} from "@/components/admin/team/admin-team-route-utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  member?: string;
};
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
  if (
    typeof search.member === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(search.member)
  )
    result.member = search.member;
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
  const detailRef = useRef<AdminTeamMemberDetail | null>(null);
  const detailRequestRef = useRef(createLatestRequestGuard());
  const pendingDetailUrlRef = useRef(false);
  const requestedMemberRef = useRef<string | null>(null);

  const replaceSearch = useCallback(
    (next: TeamSearch) => {
      void navigate({ search: parseTeamSearch(next), replace: true, resetScroll: false });
    },
    [navigate],
  );

  const loadTeam = useCallback(
    async (resetPagination = false) => {
      if (!user) return;
      const cursor = resetPagination ? undefined : search.cursor;
      const request = requestRef.current + 1;
      requestRef.current = request;
      setLoading(true);
      try {
        const [nextTeam, selfResult] = await Promise.all([
          listAdminTeam({
            data: { q: search.q, role: search.role, state: search.state, cursor },
          }),
          user.email
            ? listAdminTeam({ data: { q: user.email, limit: 1 } })
            : Promise.resolve(emptyTeam),
        ]);
        if (request !== requestRef.current) return;
        const resolvedTeam =
          cursor && teamRef.current ? mergeAdminTeamPages(teamRef.current, nextTeam) : nextTeam;
        setTeam(resolvedTeam);
        teamRef.current = resolvedTeam;
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
          detailRequestRef.current.invalidate();
          detailRef.current = null;
          setDetail(null);
          setSelectedMemberId(null);
        } else {
          setError(safeError(reason));
          setStale(Boolean(teamRef.current));
        }
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    },
    [search.cursor, search.q, search.role, search.state, user],
  );

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

  const closeConfirmation = useCallback((open: boolean) => {
    if (!open) {
      setPending(null);
      setConfirmError(null);
      setConfirmText("");
      setPendingOptions({});
    }
  }, []);

  const loadDetail = useCallback(
    async (staffId: string) => {
      const request = detailRequestRef.current.begin();
      setSelectedMemberId(staffId);
      detailRef.current = null;
      setDetail(null);
      setDetailLoading(true);
      try {
        const nextDetail = await getAdminTeamMember({ data: { staffId } });
        if (!detailRequestRef.current.isCurrent(request)) return;
        detailRef.current = nextDetail;
        setDetail(nextDetail);
        setError(null);
      } catch (reason) {
        if (!detailRequestRef.current.isCurrent(request)) return;
        if (reason instanceof Response && reason.status === 404) {
          setSelectedMemberId(null);
          detailRef.current = null;
          setDetail(null);
          pendingDetailUrlRef.current = true;
          requestedMemberRef.current = null;
          replaceSearch({ ...search, member: undefined });
          void loadTeam();
        }
        setError(safeError(reason));
      } finally {
        if (detailRequestRef.current.isCurrent(request)) setDetailLoading(false);
      }
    },
    [loadTeam, replaceSearch, search],
  );

  const closeDetail = useCallback(
    (syncUrl = true) => {
      detailRequestRef.current.invalidate();
      detailRef.current = null;
      setDetail(null);
      setDetailLoading(false);
      setSelectedMemberId(null);
      closeConfirmation(false);
      if (syncUrl) {
        pendingDetailUrlRef.current = true;
        requestedMemberRef.current = null;
        replaceSearch({ ...search, member: undefined });
      }
    },
    [closeConfirmation, replaceSearch, search],
  );

  useEffect(() => {
    if (pendingDetailUrlRef.current) {
      if ((search.member ?? null) !== requestedMemberRef.current) return;
      pendingDetailUrlRef.current = false;
    }
    if (search.member && search.member !== selectedMemberId) {
      void loadDetail(search.member);
      return;
    }
    if (!search.member && selectedMemberId) closeDetail(false);
  }, [closeDetail, loadDetail, search.member, selectedMemberId]);

  const selectMember = useCallback(
    (staffId: string) => {
      detailRequestRef.current.invalidate();
      detailRef.current = null;
      setDetail(null);
      setDetailLoading(true);
      closeConfirmation(false);
      pendingDetailUrlRef.current = true;
      requestedMemberRef.current = staffId;
      replaceSearch({ ...search, member: staffId });
    },
    [closeConfirmation, replaceSearch, search],
  );

  const refreshAll = useCallback(async () => {
    teamRef.current = null;
    setTeam(null);
    void replaceSearch(resetAdminTeamPage(search));
    await loadTeam(true);
    if (selectedMemberId) await loadDetail(selectedMemberId);
  }, [loadDetail, loadTeam, replaceSearch, search, selectedMemberId]);

  const toggleInviteRole = (role: StaffRole) =>
    setInviteRoles((roles) =>
      roles.includes(role) ? roles.filter((item) => item !== role) : [...roles, role],
    );
  const beginInviteConfirmation = () => {
    if (!inviteEmail.trim() || !inviteRoles.length) {
      setConfirmError("請提供有效電郵並選擇至少一個角色。");
      return;
    }
    setPending({
      action: "invite",
      member: { name: inviteName, email: inviteEmail },
      memberId: null,
      originalRoles: [],
      proposedRoles: inviteRoles,
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
      member: { name: detail.member.name, email: detail.member.email },
      memberId: detail.member.id,
      originalRoles: detail.member.roles,
      proposedRoles: options.roles ?? detail.member.roles,
    });
    setPendingOptions(options);
    setConfirmError(null);
    setConfirmText("");
  };

  const confirm = async () => {
    if (!pending) return;
    const activeDetail = detailRef.current;
    if (
      pending.action !== "invite" &&
      (!activeDetail || activeDetail.member.id !== pending.memberId)
    ) {
      setConfirmError("此成員資料已更新，請重新開啟詳情後再試。");
      return;
    }
    setMutating(true);
    try {
      let result: unknown;
      if (pending.action === "invite") {
        result = await inviteStaffMember({
          data: { name: inviteName.trim() || null, email: inviteEmail.trim(), roles: inviteRoles },
        });
      } else if (!activeDetail) return;
      else if (pending.action === "resend")
        result = await resendStaffInvitation({ data: { staffId: activeDetail.member.id } });
      else if (pending.action === "reset")
        result = await sendStaffPasswordReset({ data: { staffId: activeDetail.member.id } });
      else if (pending.action === "roles")
        result = await changeStaffRoles({
          data: teamActionPayload({
            action: "roles",
            staffId: activeDetail.member.id,
            currentRoles: activeDetail.member.roles,
            proposedRoles: pending.proposedRoles,
          }),
        });
      else if (pending.action === "suspend") {
        const suspendPayload = teamActionPayload({
          action: "suspend",
          staffId: activeDetail.member.id,
          currentRoles: activeDetail.member.roles,
          reassignToStaffId: pendingOptions.reassignToStaffId,
        });
        result = await changeStaffActive({
          data: suspendPayload,
        });
      } else if (pending.action === "reactivate")
        result = await changeStaffActive({
          data: { staffId: activeDetail.member.id, active: true },
        });
      const failure = teamMutationFailure(result);
      if (failure) {
        setConfirmError(failure);
        return;
      }
      if (pending.action === "invite") {
        setInviteOpen(false);
        setInviteName("");
        setInviteEmail("");
        setInviteRoles(["agent"]);
      }
      toast.success("團隊資料已更新。");
      closeConfirmation(false);
      await refreshAll();
    } catch (reason) {
      if (reason instanceof Response && reason.status === 409) {
        const conflictMessage = "資料已被其他管理員更新，已重新載入最新資料，請再次確認。";
        closeConfirmation(false);
        if (pending.memberId) await loadDetail(pending.memberId);
        setError(conflictMessage);
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
          <Dialog
            onOpenChange={(open) => {
              setInviteOpen(open);
              if (!open) setConfirmError(null);
            }}
            open={inviteOpen}
          >
            <DialogTrigger asChild>
              <Button type="button">
                <Plus aria-hidden="true" />
                邀請成員
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>邀請成員</DialogTitle>
                <DialogDescription>邀請電郵會由帳戶服務安全發送。</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="invite-name">姓名</Label>
                  <Input
                    id="invite-name"
                    onChange={(event) => setInviteName(event.target.value)}
                    value={inviteName}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="invite-email">電郵</Label>
                  <Input
                    id="invite-email"
                    onChange={(event) => setInviteEmail(event.target.value)}
                    type="email"
                    value={inviteEmail}
                  />
                </div>
                <fieldset>
                  <legend className="text-sm font-medium">角色</legend>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {(["admin", "manager", "agent"] as StaffRole[]).map((role) => (
                      <Label className="flex items-center gap-2" key={role}>
                        <Checkbox
                          checked={inviteRoles.includes(role)}
                          onCheckedChange={() => toggleInviteRole(role)}
                        />
                        {role === "admin" ? "管理員" : role === "manager" ? "主管" : "經紀"}
                      </Label>
                    ))}
                  </div>
                </fieldset>
                {confirmError ? (
                  <p className="text-sm text-destructive" role="alert">
                    {confirmError}
                  </p>
                ) : null}
              </div>
              <DialogFooter>
                <Button onClick={() => setInviteOpen(false)} type="button" variant="outline">
                  取消
                </Button>
                <Button onClick={beginInviteConfirmation} type="button">
                  下一步
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
              onSelect={selectMember}
              selectedMemberId={selectedMemberId}
            />
            <div className="grid gap-3 md:hidden">
              {directory.members.map((member) => (
                <AdminTeamMemberCard
                  canManage={canManage}
                  key={member.id}
                  member={member}
                  onSelect={selectMember}
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
          if (!open) closeDetail();
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
