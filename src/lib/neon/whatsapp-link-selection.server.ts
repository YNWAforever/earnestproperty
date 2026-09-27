import "@tanstack/react-start/server-only";
import { queryRows } from "./db.server.ts";
import { buildAdminPropertyGroupsQuery, mapAdminPropertyGroup } from "./admin-properties.server.ts";
import type { StaffAccess } from "./auth.server.ts";
import type { PropertyGroupFilters } from "./admin-properties.types.ts";
import { linkOffersFromGroups } from "../admin/whatsapp-link-selection.ts";

/** One bounded server read fixes the actual IDs before the operator configures routing. */
export async function snapshotLinkOffers(
  filters: PropertyGroupFilters,
  actor: StaffAccess,
  query = queryRows,
) {
  if (!actor.roles.some((role) => role === "admin" || role === "manager"))
    throw new Response("Forbidden", { status: 403 });
  const built = buildAdminPropertyGroupsQuery({ ...filters, page: 1, pageSize: 100 }, actor);
  const params = [...built.params];
  // The query builder owns all matching/filter/sort semantics. Only its bounded page changes.
  params[params.length - 2] = 1001;
  params[params.length - 1] = 0;
  const [result] = await query(built.statement, params);
  const total = Number(result?.total ?? 0);
  if (total > 1000) throw new Response("WA_LINK_SELECTION_LIMIT", { status: 400 });
  const groups = ((result?.rows ?? []) as Record<string, unknown>[]).map(
    (row) => mapAdminPropertyGroup(row).summary,
  );
  const offers = linkOffersFromGroups(groups);
  if (offers.length > 1000) throw new Response("WA_LINK_BATCH_LIMIT", { status: 400 });
  return {
    totalProperties: total,
    selectedProperties: groups.length,
    activeOffers: offers.length,
    excludedProperties: groups.length - new Set(offers.map((o) => o.publicListingNo)).size,
    offers,
    capturedAt: new Date().toISOString(),
  };
}
