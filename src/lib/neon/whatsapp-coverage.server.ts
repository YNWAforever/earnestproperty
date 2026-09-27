import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { queryRows } from "./db.server.ts";
import type { StaffAccess } from "./auth.server.ts";
import { companyChannel, trackingEnabled } from "./whatsapp-enquiries.server.ts";
import { buildWebsiteCoverageQuery } from "./whatsapp-coverage-query.mjs";
import {
  classifyWebsiteCoverage,
  summarizeWebsiteCoverage,
} from "../whatsapp-enquiries/coverage.mjs";
import { previewWhatsappLinkBatch } from "./whatsapp-link-batches.server.ts";
import type {
  CoverageBackfillPreview,
  WebsiteCoverageFilter,
  WebsiteCoverageItem,
  WebsiteTrackingCoverage,
} from "./whatsapp-coverage.types.ts";
import type { BatchRowDraft } from "../whatsapp-enquiries/link-batch-policy.ts";

type Actor = Pick<StaffAccess, "staffId" | "roles">;
async function authorize(actor: Actor, query = queryRows) {
  if (!actor.roles.some((role) => role === "admin" || role === "manager"))
    throw new Response("Forbidden", { status: 403 });
  const [allowed] = await query(
    "SELECT s.id FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$1::uuid AND s.active AND r.role IN ('admin','manager') LIMIT 1",
    [actor.staffId],
  );
  if (!allowed) throw new Response("Forbidden", { status: 403 });
}

export async function getWebsiteTrackingCoverage(
  filters: WebsiteCoverageFilter,
  actor: Actor,
  query = queryRows,
): Promise<WebsiteTrackingCoverage> {
  await authorize(actor, query);
  const rows = await query(buildWebsiteCoverageQuery(), [
    companyChannel(),
    filters.dealType ?? null,
    filters.q?.trim() || null,
    filters.propertyIds ?? null,
  ]);
  const classified = rows.map((row) =>
    classifyWebsiteCoverage({
      propertyId: row.property_id,
      publicListingNo: row.public_listing_no,
      dealType: row.deal_type === "rent" ? "rent" : "sale",
      candidateCount: Number(row.candidate_count ?? 0),
      code: row.code,
    }),
  ) as WebsiteCoverageItem[];
  const counts = summarizeWebsiteCoverage(classified);
  const visible = filters.missingOnly
    ? classified.filter((row) => row.status === "missing")
    : classified;
  return {
    ...counts,
    checkedAt: new Date().toISOString(),
    trackingEnabled: trackingEnabled(),
    truncated: visible.length > 1000,
    items: visible.slice(0, 1000),
  };
}

export async function previewCoverageBackfill(
  selection: { propertyIds: string[] },
  actor: Actor,
  query = queryRows,
): Promise<CoverageBackfillPreview> {
  if (!trackingEnabled()) throw new Response("WA_TRACKING_DISABLED", { status: 409 });
  if (
    !selection.propertyIds.length ||
    selection.propertyIds.length > 1000 ||
    new Set(selection.propertyIds).size !== selection.propertyIds.length
  )
    throw new Response("WA_LINK_SELECTION_LIMIT", { status: 400 });
  const coverage = await getWebsiteTrackingCoverage(
    { missingOnly: true, propertyIds: selection.propertyIds },
    actor,
    query,
  );
  const byId = new Map(coverage.items.map((item) => [item.propertyId, item]));
  const selected = selection.propertyIds.map((id) => byId.get(id));
  if (selected.some((item) => !item || item.status !== "missing"))
    throw new Response("WA_COVERAGE_SELECTION_STALE", { status: 409 });
  const rows: BatchRowDraft[] = selected.map((item) => ({
    rowKey: randomUUID(),
    placementId: "website:primary",
    input: {
      placementSource: "website",
      entryPointType: "sales",
      propertyId: item!.propertyId,
      publicListingNo: item!.publicListingNo,
      dealType: item!.dealType,
      requestedStaffId: null,
      referenceMappingId: null,
      placementVerified: true,
      enabled: true,
    },
  }));
  const preview = await previewWhatsappLinkBatch({ batchId: randomUUID(), rows }, actor, query);
  return { rows, preview, excludedRowKeys: [] };
}
