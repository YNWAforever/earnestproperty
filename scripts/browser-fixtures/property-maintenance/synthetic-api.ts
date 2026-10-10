import { useSyncExternalStore } from "react";
import { linkOffersFromGroups, linkSeedKey } from "../../../src/lib/admin/whatsapp-link-selection";
// Only an owned browser model. Real JWT, SQL, Blob and public retrieval are separate gates.
import {
  propertyManagementSchema,
  type ManagedPropertyDetail,
  type PropertyManagementInput,
  type PropertyGroupFilters,
} from "../../../src/lib/neon/admin-properties.types";
import type { BulkPropertyManagementInput } from "../../../src/lib/neon/admin-property-bulk.types";
export const actor = sessionStorage.getItem("property-fixture-actor") ?? "manager";
const staff = "20000000-0000-4000-8000-000000000001";
const estate = "30000000-0000-4000-8000-000000000001";
const image = (n: number) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><text y="30">${n}</text></svg>`)}`;
function initial(n: number): ManagedPropertyDetail {
  const no = `A${String(n).padStart(6, "0")}`;
  const offer = (dealType: "sale" | "rent") => ({
    id: `${dealType}-${n}`,
    title: "合成碧堤半島",
    dealType,
    price: dealType === "sale" ? 6000000 : null,
    rent: dealType === "rent" ? 18000 : null,
    status: n === 1 && dealType === "sale" ? "draft" : "active",
    description: "人工保護原文",
    agentId: n <= 5 ? staff : "20000000-0000-4000-8000-000000000002",
    agentName: "合成代理甲",
    editable: actor !== "viewer",
  });
  return {
    propertyNo: no,
    title: "合成碧堤半島",
    estateName: "碧堤半島",
    image: image(1),
    saleableArea: 800,
    updatedAt: "2026-10-03T01:00:00Z",
    offerings: { sale: offer("sale"), rent: offer("rent") },
    version: "v1",
    editableShared: actor !== "viewer",
    unlinked: false,
    reviewRequired: false,
    managementAvailable: true,
    shared: {
      title_zh: "合成碧堤半島",
      title_en: null,
      estate_id: estate,
      district_slug: "sham-tseng",
      address: "合成地址",
      saleable_area: 800,
      bedrooms: 3,
      bathrooms: 2,
      floor: "高層",
      description: "人工保護原文",
      images: [image(1), image(2)],
      seo_title: null,
      seo_description: null,
      video_url: null,
    },
    history: [
      {
        id: `sale-${n}`,
        listingNo: `EXTERNAL-${n}`,
        dealType: "sale",
        status: "draft",
        sourceUpdatedAt: "2026-10-02T20:17:00Z",
        current: true,
      },
    ],
    conflicts:
      n === 1
        ? [
            {
              field: "source.sale.description",
              values: ["管理：人工保護原文", "來源：來源不同文字"],
            },
          ]
        : [],
  };
}
const readStore = (): ManagedPropertyDetail[] =>
  JSON.parse(
    localStorage.getItem("property-fixture-store") ??
      JSON.stringify(Array.from({ length: 50 }, (_, n) => initial(n + 1))),
  );
const writeStore = (rows: ManagedPropertyDetail[]) =>
  localStorage.setItem("property-fixture-store", JSON.stringify(rows));
const state = {
  actor,
  role: sessionStorage.getItem("property-fixture-role") ?? actor,
  binding: staff,
  denied: false,
  staffMode: sessionStorage.getItem("property-fixture-staff-mode") ?? "ok",
  groupsMode: "ok",
  linkMode: "outside",
  linkSeedKey,
  pending: [] as { kind: string; release: () => void }[],
  changeContext: async (_actor: string, _role: string, _binding?: string) => {},
  refreshAuthUser: () => {},
  calls: [] as { name: string; input: unknown; actor: string; role: string; binding: string }[],
  saveMode: "ok",
  readMode: "ok",
  acceptedUploads: [] as { actor: string; binding: string; file: string; url: string }[],
  readFailure: false,
  uploadMode: "ok",
  bulkMode: "ok",
};
declare global {
  interface Window {
    propertyFixture: typeof state;
  }
}
window.propertyFixture = state;
const context = () => ({ actor: state.actor, role: state.role, binding: state.binding });
const call = (name: string, input?: unknown, captured = context()) =>
  state.calls.push({ name, input, ...captured });
const authListeners = new Set<() => void>();
let authState = { user: { id: actor }, loading: false, signOut: async () => {} };
export const useNeonAuth = () =>
  useSyncExternalStore(
    (listener) => {
      authListeners.add(listener);
      return () => {
        authListeners.delete(listener);
      };
    },
    () => authState,
    () => authState,
  );
state.refreshAuthUser = () => {
  authState = { ...authState, user: { id: authState.user.id } };
  for (const listener of authListeners) listener();
  call("auth-refresh");
};
state.changeContext = async (nextActor, role, binding = staff) => {
  state.actor = nextActor;
  state.role = role;
  state.binding = binding;
  if (authState.user.id !== nextActor) {
    authState = { ...authState, user: { id: nextActor } };
    for (const listener of authListeners) listener();
  }
  const { staffSessionStore } = await import("../../../src/components/admin/staff-session");
  await staffSessionStore.refresh(nextActor);
};
export const withStaffAuthHeaders = async <T>(value: T) => value;
export async function fetchStaffSession() {
  call("staff-session");
  if (state.staffMode === "delayed")
    await new Promise<void>((release) => state.pending.push({ kind: "staff", release }));
  if (state.staffMode === "failure") throw Error("owned property staff verification unavailable");
  return state.denied
    ? { status: "denied", reason: "not-staff" }
    : { status: "ok", roles: [state.role], staffId: state.binding };
}
export const fetchAdminAttentionCounts = async () => ({
  unansweredConversations: 0,
  unassignedLeads: 0,
  staleNewLeads: 0,
  leadsNeedingAttention: 0,
  identityReviewsOpen: 0,
});
// No route in this fixture polls; exported so every owned fixture serves the same API.
const noPolledRead = async (): Promise<never> => {
  throw Error("This fixture renders no polled view");
};
export const fetchAdminPageInBackground = noPolledRead;
export const fetchCommandCenterInBackground = noPolledRead;
export const fetchAdminAgents = async () => {
  call("agents");
  return [{ id: staff, name: "合成代理甲", email: null }];
};
export const fetchAdminEstateOptions = async () => {
  call("estates");
  return [{ id: estate, name_zh: "碧堤半島" }];
};
export const fetchAdminDistrictOptions = async () => [{ slug: "sham-tseng", name_zh: "深井" }];
export async function fetchAdminManagedProperty({ data }: { data: { id: string } }) {
  const captured = context();
  call("read", data, captured);
  if (state.readFailure) throw Error("合成讀回失敗");
  const found = readStore().find((row) => row.propertyNo === data.id) ?? null;
  return structuredClone(
    state.role === "agent" &&
      !Object.values(found?.offerings ?? {}).some((offer) => offer?.agentId === state.binding)
      ? null
      : found,
  );
}

export async function fetchAdminPropertyGroups({ data }: { data: PropertyGroupFilters }) {
  call("groups", data);
  const rows = structuredClone(readStore()).filter(
    (row) =>
      (state.role !== "agent" ||
        Object.values(row.offerings).some((offer) => offer?.agentId === state.binding)) &&
      (!data.q ||
        [row.propertyNo, row.estateName, `EXTERNAL-${Number(row.propertyNo.slice(1))}`].some(
          (value) => value?.includes(data.q!),
        )),
  );
  const page = data.page ?? 1,
    pageSize = data.pageSize ?? 30;
  const snapshot = {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize,
  };
  const captured = context();
  const mode = state.groupsMode;
  if (mode.startsWith("delayed"))
    await new Promise<void>((release) => state.pending.push({ kind: "groups", release }));
  call("groups-return", data, captured);
  if (mode === "delayed-denied") throw Error("owned old property read denied");
  return snapshot;
}

export async function saveAdminPropertyManagement({ data }: { data: PropertyManagementInput }) {
  call("save", data);
  const captured = context();
  const mode = state.saveMode;
  propertyManagementSchema.parse(data);
  if (state.saveMode === "conflict") throw Error("物業資料已被更新。請重新載入並核對後再提交。");
  if (state.saveMode === "revoked") throw Error("你沒有權限修改此物業或放盤。");
  const rows = readStore(),
    row = rows.find((row) => row.propertyNo === data.propertyNo)!;
  if (row.version !== data.expectedVersion) throw Error("物業資料已被更新。");
  if (data.scope === "shared") {
    Object.assign(row.shared, data.payload);
    row.title = row.shared.title_zh;
  } else
    for (const deal of data.scope === "all" ? (["sale", "rent"] as const) : [data.scope])
      Object.assign(row.offerings[deal]!, data.payload);
  row.version = `v${Number(row.version.slice(1)) + 1}`;
  writeStore(rows);
  if (mode === "read-fail") state.readFailure = true;
  if (mode === "delayed")
    await new Promise<void>((release) => state.pending.push({ kind: "save", release }));
  call("save-return", data, captured);
  return { ok: true };
}
export async function uploadAdminMedia(file: File) {
  call("upload", file.name);
  if (state.uploadMode === "fail") throw Error("合成媒體服務失敗");
  const accepted = {
    actor: state.actor,
    binding: state.binding,
    file: file.name,
    url: image(3 + state.acceptedUploads.length),
  };
  state.acceptedUploads.push(accepted);
  localStorage.setItem("property-fixture-accepted-uploads", JSON.stringify(state.acceptedUploads));
  if (state.uploadMode === "delayed")
    await new Promise<void>((release) => state.pending.push({ kind: "upload", release }));
  call("upload-return", file.name, {
    actor: accepted.actor,
    role: state.role,
    binding: accepted.binding,
  });
  return { url: accepted.url };
}
export async function applyAdminPropertyBulk({ data }: { data: BulkPropertyManagementInput }) {
  call("bulk", data);
  const captured = context();
  const mode = state.bulkMode;
  const rows = readStore();
  const results = data.items.map((item) => {
    const no = Number(item.propertyNo.slice(1));
    if (state.bulkMode === "partial" && no >= 49)
      return {
        propertyNo: item.propertyNo,
        ok: false,
        error: no === 49 ? "物業資料已被更新，請重新載入。" : "你沒有權限修改此物業。",
      };
    const row = rows.find((row) => row.propertyNo === item.propertyNo)!;
    if (row.version !== item.expectedVersion)
      return { propertyNo: item.propertyNo, ok: false, error: "版本衝突" };
    for (const deal of data.scope === "all" ? (["sale", "rent"] as const) : [data.scope])
      if (row.offerings[deal])
        Object.assign(
          row.offerings[deal]!,
          data.action.type === "status"
            ? { status: data.action.status }
            : { agentId: data.action.agentId },
        );
    row.version = `v${Number(row.version.slice(1)) + 1}`;
    return { propertyNo: item.propertyNo, ok: true };
  });
  writeStore(rows);
  if (mode === "delayed")
    await new Promise<void>((release) => state.pending.push({ kind: "bulk", release }));
  call("bulk-return", data, captured);
  if (mode === "unknown") throw Error("合成回應遺失");
  return results;
}
export const snapshotWhatsappLinkOffers = async (filters?: PropertyGroupFilters) => {
  const captured = context();
  call("snapshot", filters, captured);
  if (state.linkMode === "outside") throw Error("Link creation is outside this fixture");
  const rows = structuredClone(readStore());
  const offers = linkOffersFromGroups(rows);
  const snapshot = { offers, totalProperties: rows.length, activeOffers: offers.length };
  if (state.linkMode === "delayed")
    await new Promise<void>((release) => state.pending.push({ kind: "link", release }));
  call("snapshot-return", filters, captured);
  return snapshot;
};

export async function saveAdminProperty({ data }: { data: unknown }) {
  const captured = context();
  call("create", data, captured);
  const rows = JSON.parse(localStorage.getItem("property-fixture-created") ?? "[]");
  const saved = { id: crypto.randomUUID(), data, actor: captured.actor, binding: captured.binding };
  rows.push(saved);
  localStorage.setItem("property-fixture-created", JSON.stringify(rows));
  // The owned model reads a created listing back by its id, as the real page does.
  const base = initial(1);
  const draft = data as { title_zh?: string };
  writeStore([
    ...readStore(),
    {
      ...base,
      propertyNo: saved.id,
      title: draft.title_zh ?? base.title,
      shared: { ...base.shared, title_zh: draft.title_zh ?? base.title },
    },
  ]);
  if (state.saveMode === "delayed")
    await new Promise<void>((release) => state.pending.push({ kind: "create", release }));
  call("create-return", data, captured);
  return { id: saved.id };
}
export const generateAdminContentProposal = async () => {
  throw Error("Application model outside owned fixture");
};
export const decideAdminContentProposal = async () => {
  throw Error("Proposal apply outside owned new-property fixture");
};
