import { useState } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  BookOpen,
  Building2,
  ContactRound,
  Home,
  LogOut,
  Menu,
  MessageCircle,
  Receipt,
  RefreshCw,
  Send,
  ServerCog,
  ShieldAlert,
  UserRoundCog,
  Users,
} from "lucide-react";

import { toast } from "sonner";

import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { adminErrorText } from "@/components/admin/admin-error-text";
import { staffSessionDenialCopy, useStaffSession } from "@/components/admin/staff-session";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import type { StaffSessionDenialReason } from "@/lib/neon/admin-data.types";

// Prefix matching is reserved for sections that own child routes. Team and
// Operations deliberately stay exact so neither can illuminate the other.
const navGroups = [
  {
    heading: "Workspace",
    items: [
      { to: "/admin", label: "總覽", icon: BarChart3, activeExact: true },
      { to: "/admin/leads", label: "客戶查詢", icon: ContactRound, activeExact: false },
      { to: "/admin/listings", label: "樓盤管理", icon: Building2, activeExact: false },
      { to: "/admin/transactions", label: "成交管理", icon: Receipt, activeExact: false },
    ],
  },
  {
    heading: "Growth",
    items: [
      {
        to: "/admin/cms",
        label: "內容中心",
        icon: BookOpen,
        activeExact: false,
        includeSearch: false,
      },
      { to: "/admin/estates", label: "屋苑管理", icon: Building2, activeExact: false },
      { to: "/admin/segments", label: "客戶分群", icon: Users, activeExact: false },
      { to: "/admin/whatsapp", label: "WhatsApp", icon: MessageCircle, activeExact: false },
      { to: "/admin/blasts", label: "推廣活動", icon: Send, activeExact: false },
    ],
  },
  {
    heading: "Administration",
    items: [
      {
        to: "/admin/team",
        label: "團隊成員",
        icon: Users,
        activeExact: true,
        includeSearch: false,
      },
      { to: "/admin/agents", label: "經紀檔案", icon: UserRoundCog, activeExact: false },
      {
        to: "/admin/operations",
        label: "系統營運",
        icon: ServerCog,
        activeExact: true,
        includeSearch: false,
      },
    ],
  },
] as const;

const navLinkClassName =
  "flex min-h-11 items-center gap-2 rounded-md border-l-2 border-transparent px-3 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

// The active entry gets weight + a left indicator bar on top of the colour
// change, so "you are here" survives greyscale/colour-blind viewing, and
// aria-current announces it to screen readers.
const navLinkActiveProps = {
  className: "border-primary bg-primary/10 font-semibold text-primary",
  "aria-current": "page" as const,
};

function AdminNav({ onNavigate }: { onNavigate?: () => void }) {
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
            return (
              <Link
                key={`${item.to}-${item.label}`}
                to={item.to}
                activeOptions={{
                  exact: "activeExact" in item ? item.activeExact : true,
                  includeSearch: "includeSearch" in item ? item.includeSearch : true,
                  explicitUndefined: true,
                }}
                className={navLinkClassName}
                activeProps={navLinkActiveProps}
                onClick={onNavigate}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {item.label}
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
    <div className="flex items-center gap-2 px-2 py-2">
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
  // The server's resolution of who this signed-in user is as a staff member,
  // from the shared store in staff-session.ts. null = not known yet (or the
  // lookup itself failed): pages render as normal and the data layer still
  // enforces access. Only an explicit denial swaps the page for an explanation.
  const {
    session: staffSession,
    loading: rechecking,
    refresh: refreshStaffSession,
  } = useStaffSession(user?.id ?? null);

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
            請先使用 Neon Auth 登入，之後即可返回你原本要開啟的頁面。
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
        {/* lg:top-20 clears the 64px sticky public SiteHeader, which previously
            overlapped the sidebar's identity block and first nav item once
            scrolled. overflow-y-auto lets the last nav items and 登出 be
            reached on short laptop viewports. */}
        <aside className="hidden rounded-lg border bg-background p-3 lg:sticky lg:top-20 lg:block lg:h-[calc(100vh-6rem)] lg:overflow-y-auto">
          <AdminIdentity email={user.email} />
          <div className="mt-4">
            <AdminNav />
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
                        <AdminNav onNavigate={() => setMobileNavOpen(false)} />
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
                <h1 className="truncate text-2xl font-semibold tracking-normal">{title}</h1>
              </div>
              {breadcrumb ? (
                <div className="mt-1 text-xs text-muted-foreground">{breadcrumb}</div>
              ) : null}
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </div>
            {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
          </header>
          {staffSession?.status === "denied" ? (
            <StaffAccessDenied
              reason={staffSession.reason}
              email={user.email}
              rechecking={rechecking}
              onRecheck={() => void refreshStaffSession()}
              onSignOut={() => setSignOutOpen(true)}
            />
          ) : (
            children
          )}
        </div>
      </div>

      <AdminConfirmDialog
        open={signOutOpen}
        title="確認登出？"
        description="登出後需要重新使用 Neon Auth 登入才可返回後台。未儲存的修改會遺失。"
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
