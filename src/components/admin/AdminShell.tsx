import { useEffect, useId, useState } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  BookOpen,
  Building2,
  ContactRound,
  ExternalLink,
  Home,
  Landmark,
  Lock,
  LogOut,
  Menu,
  MessageCircle,
  Radar,
  Receipt,
  RefreshCw,
  Send,
  ServerCog,
  ShieldAlert,
  UserRoundCog,
  Users,
  UsersRound,
} from "lucide-react";

import { toast } from "sonner";

import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import {
  adminAttentionIdentity,
  attentionBadge,
  attentionBadges,
  badgeText,
  useAdminAttention,
  withAttentionTitle,
} from "@/components/admin/admin-attention";
import { adminErrorText } from "@/components/admin/admin-error-text";
import { staffSessionDenialCopy, useStaffSession } from "@/components/admin/staff-session";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import type {
  AdminAttentionCounts,
  StaffAccessRole,
  StaffSessionDenialReason,
} from "@/lib/neon/admin-data.types";
import { ROLE_LABELS } from "@/lib/admin/glossary";

// Prefix matching is reserved for sections that own child routes. Team and
// Operations deliberately stay exact so neither can illuminate the other.
//
// `roles` is the minimum staff role the destination's first server fetch
// accepts (admin-data.ts / admin-team.ts / permissions.ts). The sidebar used
// to show all 12 entries to everyone, so a `viewer` saw 12 links and could
// open one, and an `agent` hit 403 on 7 of them with no hint why. An entry the
// signed-in role cannot use still renders -- disabled, naming the role it
// needs -- the way /admin/operations already treats its capability tabs.
const STAFF: StaffAccessRole[] = ["admin", "manager", "agent"];
const EDITORS: StaffAccessRole[] = ["admin", "manager"];
const EVERYONE: StaffAccessRole[] = ["admin", "manager", "agent", "viewer"];

const navGroups = [
  {
    heading: "日常跟進",
    items: [
      { to: "/admin", label: "總覽", icon: BarChart3, activeExact: true, roles: STAFF },
      {
        to: "/admin/leads",
        label: "客戶查詢",
        icon: ContactRound,
        // Exact: /admin/leads has no child routes, and prefix matching also lit this entry on
        // 跟進工作台 (/admin/leads/command-center). includeSearch: false keeps a filtered list
        // (/admin/leads?stage=open) highlighted.
        activeExact: true,
        includeSearch: false,
        attention: "leads",
        roles: STAFF,
      },
      {
        to: "/admin/whatsapp",
        label: "WhatsApp 收件匣",
        icon: MessageCircle,
        activeExact: false,
        attention: "inbox",
        roles: STAFF,
      },
      {
        // The daily lead-triage workspace had no sidebar entry at all: its only
        // way in was one button on /admin/leads.
        to: "/admin/leads/command-center",
        label: "跟進工作台",
        icon: Radar,
        activeExact: true,
        includeSearch: false,
        roles: EDITORS,
      },
      {
        to: "/admin/listings",
        label: "樓盤管理",
        icon: Building2,
        activeExact: false,
        roles: STAFF,
      },
      {
        to: "/admin/property-sync",
        label: "盤源同步",
        icon: Building2,
        activeExact: false,
        roles: EDITORS,
      },
      {
        to: "/admin/transactions",
        label: "成交管理",
        icon: Receipt,
        activeExact: false,
        roles: STAFF,
      },
    ],
  },
  {
    heading: "內容與推廣",
    items: [
      {
        to: "/admin/cms",
        label: "內容中心",
        icon: BookOpen,
        activeExact: false,
        includeSearch: false,
        roles: EDITORS,
      },
      {
        to: "/admin/estates",
        label: "屋苑管理",
        icon: Landmark,
        activeExact: false,
        roles: EDITORS,
      },
      {
        to: "/admin/segments",
        label: "客戶分群",
        icon: UsersRound,
        activeExact: false,
        roles: EDITORS,
      },
      {
        to: "/admin/whatsapp-links",
        label: "WhatsApp 來源連結",
        icon: MessageCircle,
        activeExact: true,
        roles: ["admin", "manager"],
      },
      {
        to: "/admin/whatsapp-settings",
        label: "WhatsApp 映射設定",
        icon: MessageCircle,
        activeExact: true,
        roles: ["admin", "manager"],
      },
      { to: "/admin/blasts", label: "推廣活動", icon: Send, activeExact: false, roles: EDITORS },
    ],
  },
  {
    heading: "團隊與系統",
    items: [
      {
        to: "/admin/team",
        label: "團隊成員",
        icon: Users,
        activeExact: true,
        includeSearch: false,
        roles: EDITORS,
      },
      {
        to: "/admin/agents",
        label: "經紀檔案",
        icon: UserRoundCog,
        activeExact: false,
        roles: EDITORS,
      },
      {
        to: "/admin/analytics",
        label: "營運與轉換",
        icon: ServerCog,
        activeExact: true,
        includeSearch: false,
        roles: EDITORS,
      },
      {
        to: "/admin/operations",
        label: "系統營運",
        icon: ServerCog,
        activeExact: true,
        includeSearch: false,
        roles: EVERYONE,
      },
    ],
  },
] as const;

function roleCanOpen(
  roles: readonly StaffAccessRole[] | null,
  allowed: readonly StaffAccessRole[],
) {
  // null = the staff lookup hasn't answered (or failed): render everything as
  // usable and let the data layer enforce, rather than greying out the whole
  // sidebar on a transient error.
  if (roles === null) return true;
  return roles.some((role) => allowed.includes(role));
}

function requiredRoleLabel(allowed: readonly StaffAccessRole[]) {
  // The least-privileged role that can open it is the one worth naming.
  const order: StaffAccessRole[] = ["viewer", "agent", "manager", "admin"];
  const lowest = order.find((role) => allowed.includes(role)) ?? "admin";
  return ROLE_LABELS[lowest];
}

const navLinkClassName =
  "flex min-h-11 items-center gap-2 rounded-md border-l-2 border-transparent px-3 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

// The active entry gets weight + a left indicator bar on top of the colour
// change, so "you are here" survives greyscale/colour-blind viewing, and
// aria-current announces it to screen readers.
const navLinkActiveProps = {
  className: "border-primary bg-primary/10 font-semibold text-primary",
  "aria-current": "page" as const,
};

const navDisabledClassName =
  "flex min-h-11 cursor-not-allowed items-center gap-2 rounded-md border-l-2 border-transparent px-3 text-sm font-medium text-muted-foreground/60";

const navBadgeClassName =
  "ml-auto min-w-5 rounded-full bg-amber-500 px-1.5 text-center text-xs font-semibold leading-5 text-amber-950";

function AdminNav({
  roles,
  attention,
  onNavigate,
}: {
  roles: readonly StaffAccessRole[] | null;
  attention: AdminAttentionCounts | null;
  onNavigate?: () => void;
}) {
  // Per instance: the desktop sidebar and the mobile drawer can both be in the DOM.
  const navId = useId();
  return (
    <nav aria-label="後台選單" className="grid gap-4">
      {navGroups.map((group) => (
        <div key={group.heading ?? "root"} className="grid gap-1">
          {group.heading ? (
            <p className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.heading}
            </p>
          ) : null}
          {group.items.map((item) => {
            const Icon = item.icon;
            if (!roleCanOpen(roles, item.roles)) {
              const needed = requiredRoleLabel(item.roles);
              return (
                <span
                  key={`${item.to}-${item.label}`}
                  aria-disabled="true"
                  title={`需要 ${needed} 或以上權限，請聯絡系統管理員`}
                  className={navDisabledClassName}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="flex-1">{item.label}</span>
                  <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="sr-only">（需要 {needed} 或以上權限）</span>
                </span>
              );
            }
            // The badge is aria-hidden and its description sits in a hidden node, so the link's
            // accessible name stays exactly the label; aria-describedby still exposes the count.
            const kind = "attention" in item ? item.attention : null;
            const badge = kind ? attentionBadge(kind, attention) : null;
            const descriptionId = kind && badge ? `${navId}-${kind}` : undefined;
            return (
              <Link
                key={`${item.to}-${item.label}`}
                to={item.to}
                activeOptions={{
                  exact: "activeExact" in item ? item.activeExact : true,
                  includeSearch: "includeSearch" in item ? item.includeSearch : true,
                  explicitUndefined: true,
                }}
                aria-describedby={descriptionId}
                className={navLinkClassName}
                activeProps={navLinkActiveProps}
                onClick={onNavigate}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {item.label}
                {kind && badge ? (
                  <>
                    <span
                      aria-hidden="true"
                      data-attention-badge={kind}
                      title={badge.description}
                      className={navBadgeClassName}
                    >
                      {badgeText(badge.count)}
                    </span>
                    <span id={descriptionId} hidden>
                      {badge.description}
                    </span>
                  </>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

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
      className="rounded-lg border border-amber-700/30 bg-amber-50 p-5 text-sm text-amber-950"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{copy.title}</h2>
          <p className="mt-1">{copy.description}</p>
          {email ? (
            <p className="mt-2 text-xs text-amber-900/80">
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

function AdminIdentity({ email }: { email: string | null | undefined }) {
  return (
    <div className="px-2 py-2">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Home className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
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
        className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-md px-1 text-xs font-medium text-muted-foreground hover:text-primary"
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        查看公開網站
      </Link>
    </div>
  );
}

export function AdminShell({
  title,
  description,
  breadcrumb,
  actions,
  children,
}: {
  title: string;
  description: string;
  /** Optional "後台 › 放盤 › 編輯" style context for sub-pages. */
  breadcrumb?: React.ReactNode;
  /** Page-specific primary action(s). Replaces the old hard-coded 管理放盤 button,
   * which duplicated the sidebar's 放盤 entry and was irrelevant on CRM/WhatsApp/群發. */
  actions?: React.ReactNode;
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
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // Unknown staff identity hides private presentation until the server can
  // resolve it; lookup failure is distinct from an explicit access denial.
  // Server handlers independently enforce every read and write permission.
  const {
    session: staffSession,
    loading: rechecking,
    refresh: refreshStaffSession,
  } = useStaffSession(user?.id ?? null);
  const staffReady = staffSession?.status === "ok";
  const staffRoles = staffReady ? staffSession.roles : [];
  const [showFirstLogin, setShowFirstLogin] = useState(false);
  useEffect(() => {
    if (staffSession?.status !== "ok") {
      setShowFirstLogin(false);
      return;
    }
    setShowFirstLogin(
      sessionStorage.getItem(`earnest:first-login-checklist:${staffSession.staffId}`) !== "done",
    );
  }, [staffSession]);

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
    <div className="min-h-screen bg-slate-50/70">
      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[240px_1fr]">
        {/* The sticky offset used to be lg:top-20 to clear the public
            SiteHeader, which __root.tsx no longer renders on /admin -- that
            left 80px of dead space above the identity block and lost 96px of
            sidebar height on every page. overflow-y-auto lets the last nav
            items and 登出 be reached on short laptop viewports. */}
        <aside className="hidden rounded-lg border bg-background p-3 lg:sticky lg:top-4 lg:block lg:h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <AdminIdentity email={user.email} />
          <div className="mt-4">
            <AdminNav roles={staffRoles} attention={attention} />
          </div>
          <div className="mt-4 border-t pt-3">
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => setSignOutOpen(true)}
            >
              <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
              登出
            </Button>
          </div>
        </aside>

        <div className="min-w-0 py-4 lg:px-6 lg:py-0">
          <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {/* Below lg the sidebar is a drawer: previously the 11-item nav
                    stacked above every page, pushing the actual content ~600px
                    down on any phone or tablet visit. */}
                <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                  <SheetTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="lg:hidden"
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
                      <div className="mt-4 flex-1 overflow-y-auto pr-1">
                        <AdminNav
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
                <h1 className="truncate text-2xl font-semibold tracking-normal">
                  {staffReady ? title : "後台"}
                </h1>
              </div>
              {staffReady && breadcrumb ? (
                <div className="mt-1 text-xs text-muted-foreground">{breadcrumb}</div>
              ) : null}
              <p className="mt-1 text-sm text-muted-foreground">
                {staffReady ? description : "請先核實職員存取權限。"}
              </p>
            </div>
            {staffReady && actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
          </header>
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
                onClick={() => {
                  sessionStorage.setItem(
                    `earnest:first-login-checklist:${staffSession.staffId}`,
                    "done",
                  );
                  setShowFirstLogin(false);
                }}
              >
                我已核對
              </Button>
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
