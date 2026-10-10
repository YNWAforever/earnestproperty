// Which staff roles can open each sidebar destination. Plain data and functions, with no React
// or icon imports, so a node test can check every row against the server guard it mirrors.
//
// `roles` is the set of roles the destination's FIRST server read accepts. Hiding an entry is a
// courtesy to the signed-in role and nothing more: every server read still checks the role
// itself (admin-data.ts, admin-team.ts, permissions.ts), and none of those checks changes here.
export type NavRole = "admin" | "manager" | "agent" | "viewer";

const STAFF: readonly NavRole[] = ["admin", "manager", "agent"];
const EDITORS: readonly NavRole[] = ["admin", "manager"];
const EVERYONE: readonly NavRole[] = ["admin", "manager", "agent", "viewer"];

export const NAV_ENTRIES: readonly { to: string; roles: readonly NavRole[] }[] = [
  { to: "/admin", roles: STAFF },
  { to: "/admin/leads", roles: STAFF },
  { to: "/admin/whatsapp", roles: STAFF },
  { to: "/admin/leads/command-center", roles: EDITORS },
  { to: "/admin/listings", roles: STAFF },
  { to: "/admin/property-sync", roles: EDITORS },
  { to: "/admin/transactions", roles: STAFF },
  { to: "/admin/cms", roles: EDITORS },
  { to: "/admin/estates", roles: EDITORS },
  { to: "/admin/segments", roles: EDITORS },
  { to: "/admin/whatsapp-links", roles: EDITORS },
  { to: "/admin/whatsapp-settings", roles: EDITORS },
  { to: "/admin/blasts", roles: EDITORS },
  { to: "/admin/team", roles: EDITORS },
  { to: "/admin/agents", roles: EDITORS },
  { to: "/admin/analytics", roles: EDITORS },
  { to: "/admin/operations", roles: EVERYONE },
];

/**
 * null = the staff lookup hasn't answered (or failed): treat everything as usable and let the
 * data layer enforce, rather than emptying the whole sidebar on a transient error.
 */
export function roleCanOpen(roles: readonly string[] | null, allowed: readonly string[]) {
  if (roles === null) return true;
  return roles.some((role) => allowed.includes(role));
}

export function visibleNavEntries(roles: readonly string[] | null) {
  return NAV_ENTRIES.filter((entry) => roleCanOpen(roles, entry.roles));
}

export function navRolesFor(to: string): readonly NavRole[] {
  const entry = NAV_ENTRIES.find((candidate) => candidate.to === to);
  if (!entry) throw new Error(`No role entry for ${to}`);
  return entry.roles;
}
