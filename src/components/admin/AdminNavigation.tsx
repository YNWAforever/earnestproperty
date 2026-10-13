import { useId } from "react";
import { Link } from "@tanstack/react-router";
import {
  BarChart3,
  BookOpen,
  Building2,
  ContactRound,
  Landmark,
  MessageCircle,
  Radar,
  Receipt,
  Send,
  ServerCog,
  UserRoundCog,
  Users,
  UsersRound,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ADMIN_NAV_GROUPS } from "./admin-navigation";
import { visibleNavEntries } from "./admin-nav-roles";
import { attentionBadge, badgeText } from "./admin-attention";
import type { AdminAttentionCounts, StaffAccessRole } from "@/lib/neon/admin-data.types";

const icons = {
  overview: BarChart3,
  content: BookOpen,
  property: Building2,
  leads: ContactRound,
  estate: Landmark,
  chat: MessageCircle,
  work: Radar,
  transaction: Receipt,
  campaign: Send,
  operations: ServerCog,
  agent: UserRoundCog,
  team: Users,
  segments: UsersRound,
};

export function AdminNavigation({
  roles,
  attention,
  collapsed = false,
  onNavigate,
}: {
  roles: readonly StaffAccessRole[] | null;
  attention: AdminAttentionCounts | null;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const navId = useId();
  const visible = new Set(visibleNavEntries(roles).map((entry) => entry.to));
  const groups = ADMIN_NAV_GROUPS.map((group) => ({
    group,
    items: group.items.filter((item) => visible.has(item.to)),
  })).filter(({ items }) => items.length > 0);
  return (
    <TooltipProvider delayDuration={150}>
      <nav aria-label="後台選單" className="grid gap-4">
        {groups.map(({ group, items }) => (
          <div key={group.id} className="grid min-w-0 gap-1">
            <p
              data-admin-nav-group-label
              className={collapsed ? "sr-only" : "px-3 text-xs font-semibold text-muted-foreground"}
            >
              {group.label}
            </p>
            {items.map((item) => {
              const Icon = icons[item.icon];
              const kind = "attention" in item ? item.attention : null;
              const badge = kind ? attentionBadge(kind, attention) : null;
              const descriptionId = kind && badge ? `${navId}-${kind}` : undefined;
              const link = (
                <Link
                  to={item.to}
                  activeOptions={{
                    exact: item.activeExact,
                    includeSearch: false,
                    explicitUndefined: true,
                  }}
                  aria-label={item.label}
                  aria-describedby={descriptionId}
                  className={`relative flex min-h-11 min-w-0 items-center gap-2 rounded-md border-l-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${collapsed ? "justify-center px-1" : "px-3 py-2"}`}
                  activeProps={{
                    className: "border-primary bg-primary/10 font-semibold text-primary",
                    "aria-current": "page",
                  }}
                  inactiveProps={{ className: "border-transparent" }}
                  onClick={onNavigate}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className={collapsed ? "sr-only" : "min-w-0 break-words"}>
                    {item.label}
                  </span>
                  {kind && badge ? (
                    <>
                      <span
                        aria-hidden="true"
                        data-attention-badge={kind}
                        title={badge.description}
                        className={`min-w-5 rounded-full bg-warning-strong px-1 text-center text-xs font-semibold leading-5 text-warning-foreground ${collapsed ? "absolute -right-1 -top-1" : "ml-auto shrink-0"}`}
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
              return collapsed ? (
                <Tooltip key={item.to}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">
                    {item.label}
                    {badge ? ` · ${badge.description}` : ""}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <div key={item.to}>{link}</div>
              );
            })}
          </div>
        ))}
      </nav>
    </TooltipProvider>
  );
}
