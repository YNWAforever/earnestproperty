import { Link, useRouter } from "@tanstack/react-router";
import {
  BarChart3,
  BookOpen,
  Building2,
  ContactRound,
  FileQuestion,
  Gauge,
  Home,
  ListChecks,
  LogOut,
  MessageCircle,
  Send,
  ServerCog,
  UserRoundCog,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNeonAuth } from "@/hooks/use-neon-auth";

const navItems = [
  { to: "/admin", label: "總覽", icon: BarChart3 },
  { to: "/admin/cms", label: "CMS / FAQ", icon: BookOpen, search: { tab: undefined } },
  { to: "/admin/cms", label: "AI Agent", icon: FileQuestion, search: { tab: "faqs" } },
  { to: "/admin/listings", label: "放盤", icon: Building2 },
  { to: "/admin/agents", label: "經紀管理", icon: UserRoundCog },
  { to: "/admin/leads", label: "CRM", icon: ContactRound },
  { to: "/admin/leads/command-center", label: "Command Center", icon: Gauge },
  { to: "/admin/operations", label: "系統營運", icon: ServerCog, includeSearch: false },
  { to: "/admin/segments", label: "Segments", icon: Users },
  { to: "/admin/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { to: "/admin/blasts", label: "群發", icon: Send },
] as const;

export function AdminShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const { loading, user, signOut } = useNeonAuth();
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    await router.invalidate();
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
      <main className="mx-auto flex min-h-[70vh] max-w-md items-center px-4">
        <div className="w-full rounded-lg border bg-card p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold">職員登入</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            請先使用 Neon Auth 登入，之後即可進入 Earnest Property 後台。
          </p>
          <Button asChild className="mt-5 w-full">
            <Link to="/auth/$pathname" params={{ pathname: "sign-in" }}>
              登入後台
            </Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/70">
      <div className="mx-auto grid max-w-7xl gap-0 px-4 py-4 lg:grid-cols-[240px_1fr]">
        <aside className="rounded-lg border bg-background p-3 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
          <div className="flex items-center gap-2 px-2 py-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Home className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">Earnest Admin</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <nav className="mt-4 grid gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={`${item.to}-${item.label}`}
                  to={item.to}
                  {...("search" in item ? { search: item.search } : {})}
                  activeOptions={{
                    exact: true,
                    includeSearch: ("includeSearch" in item ? item.includeSearch : true),
                    explicitUndefined: true,
                  }}
                  className="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  activeProps={{ className: "bg-primary/10 text-primary" }}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-4 border-t pt-3">
            <Button variant="ghost" className="w-full justify-start" onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              登出
            </Button>
          </div>
        </aside>

        <main className="min-w-0 px-0 py-4 lg:px-6 lg:py-0">
          <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">{title}</h1>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            <Button asChild variant="outline">
              <Link to="/admin/listings">
                <ListChecks className="mr-2 h-4 w-4" />
                管理放盤
              </Link>
            </Button>
          </header>
          {children}
        </main>
      </div>
    </div>
  );
}

export function AdminError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      {message}
    </div>
  );
}
