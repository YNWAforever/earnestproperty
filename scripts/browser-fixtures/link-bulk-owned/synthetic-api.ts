// Presentation ports only. Actual batch SQL is verified separately on owned PostgreSQL.
export * from "../no-link/synthetic-api";
import { state, id, staff, offers, record } from "./synthetic-batches";
export async function fetchStaffSession() {
  return state.denied
    ? { status: "denied", reason: "not-staff" }
    : { status: "ok", staffId: state.binding, roles: [state.role] };
}
export async function fetchAdminAgents() {
  return [{ id: staff, name: "合成同事甲", email: null, active: true }];
}
export async function resolveWhatsappLinkImport(input: {
  offers: { publicListingNo: string; dealType: string }[];
  references: { source: string; namespace: string; externalReference: string }[];
}) {
  record("resolveImport", input);
  const references = [
    ...new Map(
      input.references.map((r) => [
        r.namespace + "|" + r.externalReference,
        {
          id: id(r.source === "28hse" ? 200 : r.source === "other" ? 202 : 201),
          namespace: r.namespace,
          externalReference: r.externalReference,
          staffId: staff,
          valid: !state.deniedReference,
        },
      ]),
    ).values(),
  ];
  return {
    offers: offers.filter((o) =>
      input.offers.some(
        (r) => r.publicListingNo === o.publicListingNo && r.dealType === o.dealType,
      ),
    ),
    references,
  };
}
export async function searchWhatsappLinkOffers() {
  // TanStack Start RESOLVES a thrown Response (server-fn-response.ts); mimic that exactly.
  return state.searchDenied ? new Response("Forbidden", { status: 403 }) : offers;
}
// With sessionStorage owned-link-bulk-links=one, the table shows one synthetic link and its
// 停用 / 重新啟用 saves are recorded as "saveLink" (no other edit is allowed).
const linkMode = () => sessionStorage.getItem("owned-link-bulk-links");
const link = {
  id: id(500),
  code: "Syn17aA",
  version: 3,
  channelId: "synthetic-channel",
  createdAt: "2026-10-01T02:00:00.000Z",
  placementVerifiedAt: "2026-10-02T02:00:00.000Z",
  referenceMappingId: null,
  placementSource: "28hse" as const,
  entryPointType: "sales" as const,
  publicListingNo: "A000001",
  propertyId: id(1),
  dealType: "sale" as const,
  requestedStaffId: staff,
  branchId: null,
  externalListingId: "4033349",
  videoId: null,
  enabled: true,
  placementVerified: true,
  requestedStaffName: "合成同事甲",
  sourcePlacementId: "4033349",
  opens: 0,
  enquiries: 0,
  readiness: "ready",
  recentTest: null,
};
export async function getWhatsappTrackingLinksPage() {
  if (linkMode() !== "one") return { items: [], total: 0, nextCursor: null };
  return { items: [{ ...link }], total: 1, nextCursor: null };
}
export async function getWebsiteTrackingCoverage() {
  return {
    eligibleOffers: 0,
    coveredOffers: 0,
    missingOffers: 0,
    conflictedOffers: 0,
    checkedAt: new Date().toISOString(),
    trackingEnabled: false,
    truncated: false,
    items: [],
    nextCursor: null,
  };
}
export async function previewCoverageBackfill() {
  throw Error("Unoperated coverage mutation");
}
export async function saveWhatsappTrackingLink(input: {
  data: { id: string; expectedVersion: number; enabled: boolean };
}) {
  if (linkMode() !== "one") throw Error("Unexpected tracking link edit");
  record("saveLink", input.data);
  if (input.data.id !== link.id || input.data.expectedVersion !== link.version)
    throw Error("WA_LINK_VERSION_CONFLICT");
  Object.assign(link, { enabled: input.data.enabled, version: link.version + 1 });
  return { ...link };
}
export async function prepareWhatsappLinkExport() {
  throw Error("Unoperated full-table export");
}
export async function getWhatsappLinkExportPage() {
  throw Error("Unoperated full-table export");
}
