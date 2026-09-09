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
 * Seven of the client's names (NAPA, 凱和山, 緹岸, 飛揚, 翠濤居, 棕月灣, 愛琴灣)
 * have no verified canonical identity in this repo. They are carried forward
 * verbatim as `unresolved` entries in client-area-presentation.ts rather than
 * being mapped onto similarly-named estates, and so are absent from both
 * arrays below. See docs/client-feedback-20260907-ledger.md.
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
