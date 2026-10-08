// Synthetic Auth/API ports only. Actual route/shell/staff store and SQL are separate evidence layers.
export * from "../no-link/synthetic-api";
import { fetchAdminLead as baseLead } from "../no-link/synthetic-api";
import { fetchAdminPage as basePage } from "../no-link/synthetic-api";
import { fetchAdminAttentionCounts as baseAttention } from "../no-link/synthetic-api";
import { syntheticIdentityReviewsOpen } from "./identity-review-api";
import { ServerFnResponseError } from "@/lib/neon/server-fn-response";
const now = "2026-10-03T00:00:00.000Z";
const state = {
  actor: sessionStorage.getItem("daily-work-actor") ?? "actor-a",
  role: sessionStorage.getItem("daily-work-role") ?? "manager",
  binding: "staff-a",
  denied: false,
  staffMode: sessionStorage.getItem("daily-work-staff-mode") ?? "ok",
  leadsMode: "ok",
  noteMode: "ok",
  mutationPending: [] as { release: () => void }[],
  acceptedNotes: [] as { actor: string; input: Record<string, unknown> }[],
  leadUpdates: [] as { actor: string; input: Record<string, unknown> }[],
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
  const mode = state.staffMode;
  if (mode === "delayed")
    await new Promise<void>((release) =>
      state.pending.push({ release, actor: state.actor, role: state.role }),
    );
  if (mode === "failure") throw Error("owned staff verification unavailable");
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
  const mode = state.leadsMode;
  if (mode.startsWith("delayed"))
    await new Promise<void>((release) =>
      state.pending.push({ release, actor: state.actor, role: state.role }),
    );
  if (mode === "delayed-denied") throw new Response("Owned forbidden", { status: 403 });
  return { rows, total: rows.length, nextCursor: null };
}

// FX-09: version and last-saved fields live in localStorage so a second tab (same
// browser context) sees the first tab's save, like a shared database row.
const leadVersionKey = (id: string) => `fx09-lead-version:${id}`;
const leadUpdateKey = (id: string) => `fx09-lead-update:${id}`;
const INITIAL_LEAD_VERSION = "2026-10-03T00:00:00.000001Z";
const leadVersion = (id: string) =>
  localStorage.getItem(leadVersionKey(id)) ?? INITIAL_LEAD_VERSION;
function bumpLeadVersion(id: string) {
  const [head, micros] = leadVersion(id).replace("Z", "").split(".");
  const next = `${head}.${String(Number(micros) + 1).padStart(6, "0")}Z`;
  localStorage.setItem(leadVersionKey(id), next);
  return next;
}

export async function fetchAdminLead({ data }: { data: { id: string } }) {
  if (!data.id.startsWith("40000000-0000-4000-8000-")) return baseLead({ data });
  call("lead-detail", data);
  const ordinal = Number(data.id.slice(-12)) - 1;
  if (state.denied || ordinal < 0 || ordinal >= scopedCount())
    throw new Response("Owned forbidden", { status: 403 });
  const stored = localStorage.getItem(leadUpdateKey(data.id));
  const update = stored ? (JSON.parse(stored) as Record<string, unknown>) : undefined;
  return {
    id: data.id,
    name: "每日工作合成查詢" + ordinal,
    stage: "contacted",
    intent: "buyer",
    source: "website",
    created_at: now,
    assigned_agent_id: "20000000-0000-4000-8000-000000000001",
    contact_id: null,
    phone: null,
    email: null,
    budget_min: null,
    budget_max: null,
    opt_in_whatsapp: false,
    note: null,
    preferred_estates: [],
    ...update,
    version: leadVersion(data.id),
    activities: state.acceptedNotes
      .filter((x) => x.input.lead_id === data.id)
      .map((x, n) => ({
        id: String(n),
        activity_type: "note",
        body: x.input.body,
        staff_name: x.actor,
        created_at: now,
      })),
  };
}
export async function createAdminLeadActivity({ data }: { data: Record<string, unknown> }) {
  call("lead-note", data);
  const mode = state.noteMode;
  if (mode !== "delayed-failure")
    state.acceptedNotes.push({ actor: state.actor, input: { ...data } });
  if (mode.startsWith("delayed"))
    await new Promise<void>((release) => state.mutationPending.push({ release }));
  call("lead-note-return");
  if (mode === "delayed-failure") throw Error("Owned old note failed");
  return { ok: true };
}
export async function updateAdminLead({ data }: { data: Record<string, unknown> }) {
  call("lead-update", data);
  const id = String(data.id);
  if (data.expected_version !== leadVersion(id))
    throw new ServerFnResponseError("LEAD_CHANGED", 409);
  const version = bumpLeadVersion(id);
  const { expected_version: _expected, ...fields } = data;
  localStorage.setItem(leadUpdateKey(id), JSON.stringify(fields));
  state.leadUpdates.push({ actor: state.actor, input: { ...data } });
  return { ok: true, version, changed: [] };
}

// FX-12: the 可能重複客戶 count is a manager+ number; agents always get 0 (as on the server).
export async function fetchAdminAttentionCounts() {
  const counts = await baseAttention();
  return {
    ...counts,
    identityReviewsOpen: ["admin", "manager"].includes(state.role)
      ? syntheticIdentityReviewsOpen()
      : 0,
  };
}
