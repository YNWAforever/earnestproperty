/**
 * Naming and identity for the website's per-listing WhatsApp tracking links.
 *
 * ## Why readable codes
 *
 * The shipped provisioning path mints a 32-character random reference
 * (`mintReference()`), so a link is impossible to identify from the code alone.
 * Staff debugging a campaign, or matching a `/w/<code>` hit in the logs back to a
 * listing, had to look the code up. The database only requires
 * `^[A-Za-z0-9_-]{16,64}$` (`whatsapp_tracking_links_code_check`) and
 * `trackedRedirect` applies the same pattern, so a readable code is legal:
 *
 *     web-R037767-sale      listing R037767, sale page
 *     web-R037767-rent      listing R037767, rent page
 *
 * Public listing numbers are 7 characters today, so the code is exactly the
 * 16-character minimum. Both parts are validated here rather than assumed, so a
 * future listing-number format fails loudly instead of silently producing a code
 * the database or the redirect route would reject.
 *
 * ## Why the placement key is recomputed, not invented
 *
 * `whatsapp_tracking_link_placements.placement_key` is a 64-character primary key
 * derived by `canonicalBatchRow()` in `src/lib/whatsapp-enquiries/link-batch-policy.ts`:
 *
 *     sha256(JSON.stringify([channelId, publicListingNo, dealType, placementSource,
 *                             entryPointType, placementId, requestedStaffId,
 *                             referenceMappingId, branchId]))
 *
 * The batch importer uses that key to recognise "this placement is already
 * reserved", so a provisioned link must carry the same key for the two paths to
 * agree. `website-link-codes.test.mjs` asserts this function produces exactly
 * what `canonicalBatchRow()` produces, which is what keeps them from drifting.
 */

import { createHash } from "node:crypto";

/** Same pattern the database check and `trackedRedirect` enforce. */
export const TRACKING_CODE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** The public listing number format this deployment actually issues. */
const LISTING_NO_PATTERN = /^[A-Za-z0-9]{4,24}$/;

export const WEBSITE_PLACEMENT_ID = "website:primary";

/**
 * @param {string} publicListingNo
 * @param {"sale" | "rent"} dealType
 * @returns {string}
 */
export function websiteLinkCode(publicListingNo, dealType) {
  if (!LISTING_NO_PATTERN.test(publicListingNo ?? ""))
    throw new Error("WA_LINK_LISTING_NO_INVALID");
  if (dealType !== "sale" && dealType !== "rent") throw new Error("WA_LINK_DEAL_TYPE_INVALID");
  // canonicalBatchRow() upper-cases the listing number before hashing it, so the
  // code and the placement identity use the same normalised form.
  const code = `web-${publicListingNo.toUpperCase()}-${dealType}`;
  if (!TRACKING_CODE_PATTERN.test(code)) throw new Error("WA_LINK_CODE_INVALID");
  return code;
}

/**
 * The placement identity the batch importer reserves. Optional context
 * (staff, reference mapping, branch) is null for website listing pages.
 *
 * @param {{ channelId: string; publicListingNo: string; dealType: "sale" | "rent" }} input
 * @returns {string}
 */
export function websitePlacementKey({ channelId, publicListingNo, dealType }) {
  if (!channelId) throw new Error("WA_LINK_CHANNEL_REQUIRED");
  const identity = [
    channelId,
    publicListingNo.toUpperCase(),
    dealType,
    "website",
    "sales",
    WEBSITE_PLACEMENT_ID,
    null,
    null,
    null,
  ];
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

/**
 * Turns the canonical-listing coverage rows into the rows to provision.
 *
 * Idempotent by construction: a listing that already has exactly one usable
 * website link is skipped, and the caller is expected to have read the coverage
 * from the same query the site uses.
 *
 * @param {{
 *   channelId: string;
 *   listings: ReadonlyArray<{ property_id: string; public_listing_no: string; deal_type: "sale" | "rent"; candidate_count: number | string }>;
 * }} input
 * @returns {{ create: Array<{ propertyId: string; publicListingNo: string; dealType: "sale" | "rent"; code: string; placementKey: string }>; skip: number; ambiguous: number }}
 */
export function planWebsiteLinks({ channelId, listings }) {
  const create = [];
  let skip = 0;
  let ambiguous = 0;
  const seenCodes = new Set();
  for (const listing of listings) {
    const count = Number(listing.candidate_count);
    if (count === 1) {
      skip++;
      continue;
    }
    if (count > 1) {
      // More than one usable link already exists; provisioning another would make
      // it worse. The coverage log reports these and a human decides.
      ambiguous++;
      continue;
    }
    const code = websiteLinkCode(listing.public_listing_no, listing.deal_type);
    if (seenCodes.has(code)) throw new Error(`WA_LINK_DUPLICATE_CODE:${code}`);
    seenCodes.add(code);
    create.push({
      propertyId: listing.property_id,
      publicListingNo: listing.public_listing_no,
      dealType: listing.deal_type,
      code,
      placementKey: websitePlacementKey({
        channelId,
        publicListingNo: listing.public_listing_no,
        dealType: listing.deal_type,
      }),
    });
  }
  return { create, skip, ambiguous };
}
