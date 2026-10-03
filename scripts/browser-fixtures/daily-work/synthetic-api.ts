// Synthetic Auth/API ports only. Actual route/shell/staff store and SQL are separate evidence layers.
export * from "../no-link/synthetic-api";
import { fetchAdminPage as basePage } from "../no-link/synthetic-api";
const now = "2026-10-03T00:00:00.000Z";
const state = {
  actor: sessionStorage.getItem("daily-work-actor") ?? "actor-a",
  role: sessionStorage.getItem("daily-work-role") ?? "manager",
  binding: "staff-a",
  denied: false,
  empty: false,
  overviewMode: "ok",
  teamMode: "ok",
  calls: [] as { name: string; actor: string; role: string; binding: string; input: unknown }[],
  pending: [] as { release: () => void; actor: string; role: string }[],
  changeContext: async (_actor: string, _role: string, _binding?: string, _denied?: boolean) => {},
};
declare global {
  interface Window {
    dailyWorkFixture: typeof state;
  }
}
window.dailyWorkFixture = state;
const call = (name: string, input?: unknown) =>
  state.calls.push({ name, actor: state.actor, role: state.role, binding: state.binding, input });
const scopedCount = () =>
  state.empty
    ? 0
    : ["admin", "manager"].includes(state.role)
      ? 7
      : state.binding === "staff-a"
        ? 2
        : 3;
export async function fetchStaffSession() {
  call("staff-session");
  return state.denied
    ? { status: "denied", reason: "not-staff" }
    : { status: "ok", staffId: state.binding, roles: [state.role] };
}
export async function fetchAdminOverview() {
  call("overview");
  const mode = state.overviewMode;
  const snapshot = {
    publicProperties: 2,
    publicOffers: 3,
    inventoryCheckedAt: now,
    openLeads: scopedCount(),
    openConversations: scopedCount(),
    contacts: scopedCount(),
    activeCampaigns: null,
    scope: ["admin", "manager"].includes(state.role) ? "all" : "own",
    checkedAt: now,
  };
  if (mode.startsWith("delayed"))
    await new Promise<void>((release) =>
      state.pending.push({ release, actor: state.actor, role: state.role }),
    );
  if (mode === "failure") throw Error("owned overview unavailable");
  if (mode === "denied" || mode === "delayed-denied")
    throw new Response("Owned forbidden", { status: 403 });
  return snapshot;
}
function requireManager() {
  if (state.denied || !["admin", "manager"].includes(state.role))
    throw new Response("Owned forbidden", { status: 403 });
}
export async function listAdminTeam() {
  call("team");
  requireManager();
  if (state.teamMode === "failure") throw Error("owned directory unavailable");
  return {
    members: [
      {
        id: "20000000-0000-4000-8000-000000000091",
        name: "受限合成團隊成員",
        needsAttention: true,
      },
    ],
    counts: { active: 7, invited: 1, suspended: 0, attention: 1 },
    nextCursor: null,
  };
}
export async function fetchOperationsHealth() {
  call("health");
  requireManager();
  return { data: { status: "healthy", checks: [], checkedAt: now }, requestId: "owned-health" };
}
export async function fetchOperationsAudit() {
  call("audit");
  requireManager();
  return {
    data: {
      rows: [{ id: "audit-owned", action: "staff.roles_changed", outcome: "success" }],
      nextCursor: null,
    },
    requestId: "owned-audit",
  };
}
export async function fetchAdminPage({ data }: { data: { resource: string; stage?: string } }) {
  if (data.resource !== "leads") return basePage({ data });
  call("leads", data);
  const rows = Array.from({ length: scopedCount() }, (_, n) => ({
    id: `40000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`,
    name: "每日工作合成查詢" + n,
    stage: n === 0 ? "contacted" : "new",
    intent: "buyer",
    source: "website",
    created_at: now,
    assigned_agent_id: "20000000-0000-4000-8000-000000000001",
    phone: null,
    email: null,
    opt_in_whatsapp: false,
  }));
  return { rows, total: rows.length, nextCursor: null };
}
