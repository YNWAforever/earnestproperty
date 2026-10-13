import { useEffect, useRef, useState } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  ExternalLink,
  Home,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";

import { toast } from "sonner";

import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import {
  adminAttentionIdentity,
  attentionBadges,
  useAdminAttention,
  withAttentionTitle,
} from "@/components/admin/admin-attention";
import { adminErrorText } from "@/components/admin/admin-error-text";
import {
  confirmFirstLoginChecklistFor,
  navRolesForStaffSession,
  staffSessionDenialCopy,
  useStaffSession,
} from "@/components/admin/staff-session";
import { Button } from "@/components/ui/button";
import {
  confirmFirstLoginChecklist,
  fetchFirstLoginChecklistDone,
} from "@/lib/neon/staff-checklist";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import type { StaffSessionDenialReason } from "@/lib/neon/admin-data.types";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminNavigation } from "@/components/admin/AdminNavigation";

/**
 * Shown in place of the page when the signed-in Neon Auth account is not a
 * usable staff account. Before this, such a user got the full shell and every
 * page failed with a generic no-permission error -- for an invited member
 * whose email Neon Auth never verified (its default), that was permanent and
 * unexplained, and an admin changing their roles changed nothing.
 */
function StaffAccessDenied({
  reason,
  email,
  rechecking,
  onRecheck,
  onSignOut,
}: {
  reason: StaffSessionDenialReason;
  email: string | null | undefined;
  rechecking: boolean;
  onRecheck: () => void;
  onSignOut: () => void;
}) {
  const copy = staffSessionDenialCopy(reason);
  return (
    <div
      role="alert"
      data-staff-access-denied={reason}
      className="rounded-lg border border-warning-accent/30 bg-warning p-5 text-sm text-warning-foreground"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{copy.title}</h2>
          <p className="mt-1">{copy.description}</p>
          {email ? (
            <p className="mt-2 text-xs text-warning-foreground/80">
              目前登入電郵：<span className="font-medium">{email}</span>
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={onRecheck} disabled={rechecking} size="sm" type="button">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {rechecking ? "檢查中…" : "重新檢查"}
            </Button>
            <Button onClick={onSignOut} size="sm" type="button" variant="outline">
              <LogOut className="h-4 w-4" aria-hidden="true" />
              登出
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminIdentity({
  email,
  collapsed = false,
}: {
  email: string | null | undefined;
  collapsed?: boolean;
}) {
  return (
    <div className={collapsed ? "py-[8px]" : "px-[8px] py-[8px]"}>
      <div className="flex items-center gap-[8px]">
        <div className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Home className="h-[16px] w-[16px]" aria-hidden="true" />
        </div>
        <div className={collapsed ? "sr-only" : "min-w-0"}>
          <p className="truncate text-sm font-semibold">Earnest Admin</p>
          <p className="truncate text-xs text-muted-foreground" title={email ?? undefined}>
            {email}
          </p>
        </div>
      </div>
      {/* The public SiteHeader no longer renders on /admin, so this is the
          only way from the back office to the site it manages. */}
      <Link
        to="/"
        aria-label="查看公開網站"
        title={collapsed ? "查看公開網站" : undefined}
        className={`mt-[8px] inline-flex min-h-[44px] items-center gap-[6px] rounded-md px-[4px] text-xs font-medium text-muted-foreground hover:text-primary ${collapsed ? "w-[44px] justify-center" : ""}`}
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        <span className={collapsed ? "sr-only" : undefined}>查看公開網站</span>
      </Link>
    </div>
  );
}

export function AdminShell({
  title,
  description,
  breadcrumb,
  actions,
  contentWidth = "standard",
  children,
}: {
  title: string;
  description: string;
  /** Optional "後台 › 放盤 › 編輯" style context for sub-pages. */
  breadcrumb?: React.ReactNode;
  /** Page-specific primary action(s). Replaces the old hard-coded 管理放盤 button,
   * which duplicated the sidebar's 放盤 entry and was irrelevant on CRM/WhatsApp/群發. */
  actions?: React.ReactNode;
  contentWidth?: "standard" | "wide" | "form";
  children: React.ReactNode;
}) {
  const { loading, user, signOut } = useNeonAuth();
  const router = useRouter();
  // The path the user actually asked for, so the sign-in gate can send them
  // back to it. Includes the query string, so a filtered view survives too.
  const requestedPath = useRouterState({
    select: (state) => `${state.location.pathname}${state.location.searchStr ?? ""}`,
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Expanded on the server and the first client render; storage is optional.
  const [navCollapsed, setNavCollapsed] = useState(false);
  useEffect(() => {
    try {
      setNavCollapsed(localStorage.getItem("earnest:admin-nav-collapsed") === "true");
    } catch {
      /* unavailable storage must not block navigation */
    }
  }, []);
  function toggleNavigation() {
    const next = !navCollapsed;
    setNavCollapsed(next);
    try {
      localStorage.setItem("earnest:admin-nav-collapsed", String(next));
    } catch {
      /* the preference remains usable for this mounted page */
    }
  }

  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // Unknown staff identity hides private presentation until the server can
  // resolve it; lookup failure is distinct from an explicit access denial.
  // Server handlers independently enforce every read and write permission.
  const {
    session: staffSession,
    loading: rechecking,
    settled: staffLookupSettled,
    refresh: refreshStaffSession,
  } = useStaffSession(user?.id ?? null);
  const staffReady = staffSession?.status === "ok";
  // A denial is a definite answer: no entry. While the lookup is still loading there are no
  // links either; null (every entry) is only for a lookup that finished and failed, and the
  // server still enforces.
  const staffRoles = navRolesForStaffSession(staffSession, staffLookupSettled);
  const [showFirstLogin, setShowFirstLogin] = useState(false);
  const [checklistSaving, setChecklistSaving] = useState(false);
  const [checklistError, setChecklistError] = useState(false);
  const checklistStaffId = staffSession?.status === "ok" ? staffSession.staffId : null;
  useEffect(() => {
    setChecklistError(false);
    if (!checklistStaffId) {
      setShowFirstLogin(false);
      return;
    }
    // Only a positive answer is cached, per browser; the server read runs at most once per
    // account per browser. Storage can be unavailable (private mode), so it never blocks.
    const cacheKey = `earnest:first-login-checklist:${checklistStaffId}`;
    try {
      if (localStorage.getItem(cacheKey) === "done") {
        setShowFirstLogin(false);
        return;
      }
    } catch {
      // fall through to the server read
    }
    setShowFirstLogin(false);
    let current = true;
    void fetchFirstLoginChecklistDone()
      .then((done) => {
        if (!current) return;
        if (done) {
          try {
            localStorage.setItem(cacheKey, "done");
          } catch {
            // cache is optional
          }
        }
        setShowFirstLogin(!done);
      })
      .catch(() => {
        // Could not tell: show the checklist rather than hide it.
        if (current) setShowFirstLogin(true);
      });
    return () => {
      current = false;
    };
  }, [checklistStaffId]);
  const checklistStaffIdRef = useRef<string | null>(checklistStaffId);
  checklistStaffIdRef.current = checklistStaffId;
  async function confirmChecklist() {
    if (!checklistStaffId) return;
    setChecklistSaving(true);
    setChecklistError(false);
    const saved = await confirmFirstLoginChecklistFor({
      staffId: checklistStaffId,
      currentStaffId: () => checklistStaffIdRef.current,
      confirm: confirmFirstLoginChecklist,
      cacheDone: (staffId) => {
        try {
          localStorage.setItem(`earnest:first-login-checklist:${staffId}`, "done");
        } catch {
          // cache is optional
        }
      },
      hidePanel: () => setShowFirstLogin(false),
    });
    setChecklistSaving(false);
    if (!saved) setChecklistError(true);
  }

  // Waiting-work counts for the nav badges and the tab title. Only admin, manager and agent
  // read them; anyone else (or an unresolved staff lookup) gets a null identity and no request.
  // The identity names whose counts these are, so a change of user, staff record or roles
  // never shows the previous one's counts.
  const identity = adminAttentionIdentity(user?.id ?? null, staffSession);
  const attention = useAdminAttention(identity);
  // Each admin route sets its own title; re-apply the count prefix after every navigation.
  useEffect(() => {
    document.title = withAttentionTitle(document.title, attentionBadges(attention).total);
  }, [attention, requestedPath]);
  useEffect(
    () => () => {
      document.title = withAttentionTitle(document.title, 0);
    },
    [],
  );

  async function handleSignOut() {
    // Sat one item below 群發 in the sidebar with no confirmation, no pending
    // state and no failure surface, on all 15 pages: a mis-click ended the
    // session, and a failed sign-out looked identical to a successful one.
    setSigningOut(true);
    try {
      await signOut();
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "登出失敗，請再試一次。");
    } finally {
      setSigningOut(false);
      setSignOutOpen(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="mt-6 h-72 w-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md items-center px-4">
        <div className="w-full rounded-lg border bg-card p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold">職員登入</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            請先以職員帳戶登入，之後即可返回你原本要開啟的頁面。
          </p>
          <Button asChild className="mt-5 w-full">
            {/* Carries the requested admin path so sign-in returns here instead
                of dropping the user on the public homepage. The value is
                validated on the auth route, not trusted. */}
            <Link
              to="/auth/$pathname"
              params={{ pathname: "sign-in" }}
              search={{ redirect: requestedPath }}
            >
              登入後台
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#admin-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-background focus:p-3 focus:ring-2"
      >
        跳至後台內容
      </a>
      <div data-admin-shell data-nav-collapsed={navCollapsed} className="admin-shell-grid">
        <aside className="hidden min-w-0 flex-col border-r bg-background p-[12px] lg:sticky lg:top-0 lg:flex lg:h-dvh">
          <Button
            type="button"
            variant="ghost"
            className="h-auto min-h-[44px] w-full shrink-0 px-[4px] py-[4px]"
            aria-expanded={!navCollapsed}
            aria-controls="admin-desktop-navigation"
            aria-label={navCollapsed ? "展開後台選單" : "收合後台選單"}
            onClick={toggleNavigation}
          >
            {navCollapsed ? (
              <PanelLeftOpen className="h-5 w-5" aria-hidden="true" />
            ) : (
              <>
                <PanelLeftClose className="mr-2 h-5 w-5" aria-hidden="true" />
                收合選單
              </>
            )}
          </Button>
          <AdminIdentity email={user.email} collapsed={navCollapsed} />
          <div
            id="admin-desktop-navigation"
            className="mt-[16px] min-h-0 flex-1 overflow-y-auto overflow-x-clip py-[4px]"
          >
            <AdminNavigation roles={staffRoles} attention={attention} collapsed={navCollapsed} />
          </div>
          <div className="mt-[16px] shrink-0 border-t pt-[12px]">
            <Button
              type="button"
              variant="ghost"
              aria-label="登出"
              className={`h-auto min-h-[44px] w-full py-[4px] ${navCollapsed ? "justify-center px-[4px]" : "justify-start"}`}
              onClick={() => setSignOutOpen(true)}
            >
              <LogOut
                className={`h-4 w-4 shrink-0 ${navCollapsed ? "" : "mr-2"}`}
                aria-hidden="true"
              />
              <span className={navCollapsed ? "sr-only" : undefined}>登出</span>
            </Button>
          </div>
        </aside>

        <div className="admin-page">
          <div
            id="admin-content"
            tabIndex={-1}
            data-admin-content
            data-content-width={contentWidth}
            className="admin-content"
          >
            <AdminPageHeader
              title={staffReady ? title : "後台"}
              description={staffReady ? description : "請先核實職員存取權限。"}
              breadcrumb={staffReady ? breadcrumb : undefined}
              actions={staffReady ? actions : undefined}
              navigation={
                <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                  <SheetTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="shrink-0 lg:hidden"
                      aria-label="開啟後台選單"
                    >
                      <Menu className="h-5 w-5" aria-hidden="true" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-80 max-w-[calc(100vw-2rem)]">
                    <SheetTitle className="sr-only">後台選單</SheetTitle>
                    <div className="flex h-full flex-col">
                      <div className="mt-8">
                        <AdminIdentity email={user.email} />
                      </div>
                      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
                        <AdminNavigation
                          roles={staffRoles}
                          attention={attention}
                          onNavigate={() => setMobileNavOpen(false)}
                        />
                      </div>
                      <div className="border-t pt-3">
                        <Button
                          variant="ghost"
                          className="w-full justify-start"
                          onClick={() => setSignOutOpen(true)}
                        >
                          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                          登出
                        </Button>
                      </div>
                    </div>
                  </SheetContent>
                </Sheet>
              }
            />
            <div data-admin-body className="w-full min-w-0">
              {showFirstLogin && staffSession?.status === "ok" ? (
                <section
                  aria-label="首次登入核對"
                  className="mb-4 rounded-lg border bg-card p-4 text-sm"
                >
                  <h2 className="font-semibold">首次登入核對</h2>
                  <ol className="mt-2 list-decimal space-y-1 pl-5">
                    <li>
                      <a className="underline" href="/account/settings">
                        核對本人登入姓名及帳戶資料
                      </a>
                    </li>
                    <li>確認職員角色及所屬分行；資料不符時聯絡管理員。</li>
                    <li>需要 Inbox 分派或手機通知時，請管理員在映射設定核實各條路線。</li>
                  </ol>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    disabled={checklistSaving}
                    onClick={() => void confirmChecklist()}
                  >
                    我已核對
                  </Button>
                  {checklistError ? (
                    <p role="alert" className="mt-2 text-sm text-destructive">
                      未能記錄核對，請重試。
                    </p>
                  ) : null}
                </section>
              ) : null}
              {staffSession?.status === "denied" ? (
                <StaffAccessDenied
                  reason={staffSession.reason}
                  email={user.email}
                  rechecking={rechecking}
                  onRecheck={() => void refreshStaffSession()}
                  onSignOut={() => setSignOutOpen(true)}
                />
              ) : staffReady ? (
                children
              ) : (
                <section role="status" className="rounded-lg border bg-card p-5 text-sm">
                  <h2 className="text-base font-semibold">
                    {rechecking ? "正在核實職員權限" : "未能核實職員權限"}
                  </h2>
                  <p className="mt-2 text-muted-foreground">
                    {rechecking
                      ? "核實完成後才會顯示頁面資料。"
                      : "暫時無法確認職員權限，頁面資料已隱藏。請重新檢查；如登入已失效，請登出後重新登入。"}
                  </p>
                  <Button
                    className="mt-4"
                    size="sm"
                    type="button"
                    disabled={rechecking}
                    onClick={() => void refreshStaffSession()}
                  >
                    {rechecking ? "檢查中…" : "重新檢查"}
                  </Button>
                </section>
              )}
            </div>
          </div>
        </div>
      </div>

      <AdminConfirmDialog
        open={signOutOpen}
        title="確認登出？"
        description="登出後需要重新以職員帳戶登入才可返回後台。未儲存的修改會遺失。"
        confirmLabel="登出"
        isPending={signingOut}
        onOpenChange={setSignOutOpen}
        onConfirm={() => void handleSignOut()}
      />
    </div>
  );
}

export function AdminError({ message }: { message: string }) {
  return (
    // role="alert" so a failed load/save is announced instead of appearing
    // silently -- this component is the error surface for every admin page.
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
    >
      {adminErrorText(message)}
    </div>
  );
}
