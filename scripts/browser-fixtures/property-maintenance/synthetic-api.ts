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
    agentId: staff,
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
  calls: [] as { name: string; input: unknown }[],
  saveMode: "ok",
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
const call = (name: string, input?: unknown) => state.calls.push({ name, input });
const authState = { user: { id: actor }, loading: false, signOut: async () => {} };
export const useNeonAuth = () => authState;
export const withStaffAuthHeaders = async <T>(value: T) => value;
export const fetchStaffSession = async () => ({ status: "ok", roles: [actor], staffId: staff });
export const fetchAdminAgents = async () => [{ id: staff, name: "合成代理甲", email: null }];
export const fetchAdminEstateOptions = async () => [{ id: estate, name_zh: "碧堤半島" }];
export const fetchAdminDistrictOptions = async () => [{ slug: "sham-tseng", name_zh: "深井" }];
export async function fetchAdminManagedProperty({ data }: { data: { id: string } }) {
  call("read", data);
  if (state.readFailure) throw Error("合成讀回失敗");
  return readStore().find((row) => row.propertyNo === data.id) ?? null;
}
export async function fetchAdminPropertyGroups({ data }: { data: PropertyGroupFilters }) {
  call("groups", data);
  const rows = readStore().filter(
    (row) =>
      !data.q ||
      [row.propertyNo, row.estateName, `EXTERNAL-${Number(row.propertyNo.slice(1))}`].some(
        (value) => value?.includes(data.q!),
      ),
  );
  const page = data.page ?? 1,
    pageSize = data.pageSize ?? 30;
  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize,
  };
}
export async function saveAdminPropertyManagement({ data }: { data: PropertyManagementInput }) {
  call("save", data);
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
  if (state.saveMode === "read-fail") state.readFailure = true;
  return { ok: true };
}
export async function uploadAdminMedia(file: File) {
  call("upload", file.name);
  if (state.uploadMode === "fail") throw Error("合成媒體服務失敗");
  return { url: image(3) };
}
export async function applyAdminPropertyBulk({ data }: { data: BulkPropertyManagementInput }) {
  call("bulk", data);
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
  if (state.bulkMode === "unknown") throw Error("合成回應遺失");
  return results;
}
export const snapshotWhatsappLinkOffers = async () => {
  throw Error("Link creation is outside this fixture");
};
