/**
 * The 青山公路屋苑 home page card list, re-ordered and split by the client's
 * 2026-09-07 feedback (網頁07092026.docx p2).
 *
 * The client gave a 12-item primary order ending in a 13th tile labelled 其他,
 * which reveals a further seven estates. 其他 is a *group control*, not an
 * estate: it has no slug, no registry entry, no `estates` row, no unit count,
 * no price and no detail page. It is rendered by index.tsx as a button, and
 * nothing in this file fabricates a record for it.
 *
 * Order and membership come from client-area-presentation.ts; identity (slug,
 * name, photo, district, hasPage) still comes from estate-registry.ts (DR-10).
 * units/avgPsf/listingCount stay null here and are merged from the live DB at
 * render time by CoreEstateGrid, exactly as core-estates.ts's own entries are
 * -- hardcoding them would let the card drift from the estate page.
 *
 * 凱和山 stays unresolved in client-area-presentation.ts. The 2026-10-26
 * listing-evidenced additions follow the existing 其他 sequence and receive
 * photos and public content through the scoped estate data migration.
 * See docs/client-feedback-20260907-ledger.md.
 */
import { type CoreEstate, coreEstatesFromRefs } from "./core-estates.ts";
import { getClientAreaGroup } from "./client-area-presentation.ts";

const WEST = getClientAreaGroup("castle-peak-road-west");

/** The client's primary cards, in their order, before the 其他 tile. */
export const castlePeakRoadEstates: CoreEstate[] = coreEstatesFromRefs(WEST.primary);

/**
 * The estates revealed by the 其他 tile, in the client's order. Kept a separate
 * array (rather than appended to the primary list with a flag) so no consumer
 * can accidentally render the same estate in both tiers, and so a count of the
 * primary cards stays a count of the primary cards.
 */
export const castlePeakRoadOtherEstates: CoreEstate[] = coreEstatesFromRefs(WEST.secondary);

/** The exact label the client wrote for the group control. */
export const CASTLE_PEAK_ROAD_OTHER_LABEL = "其他";
