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
export async function getWhatsappTrackingLinksPage() {
  return { items: [], total: 0, nextCursor: null };
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
export async function saveWhatsappTrackingLink() {
  throw Error("Unexpected tracking link edit");
}
export async function prepareWhatsappLinkExport() {
  throw Error("Unoperated full-table export");
}
export async function getWhatsappLinkExportPage() {
  throw Error("Unoperated full-table export");
}
