// FX-13 Task 2 (L-04): the old site's search URLs looked like
// /property/b<estate name>$ (e.g. /property/b碧堤半島$). They now land on
// /property/$listingNo, whose loader calls this only after the listing lookup
// misses. Pure: no I/O, imports only the estate registry.
import { estateRegistry } from "../content/estate-registry.ts";

/** Old site search URLs: /property/b<estate name>$ (decoded param, trailing literal "$"). */
export const OLD_SEARCH_CODE = /^b(.{1,40})\$$/u;

/** FX-11b public-number grammar; a match is never an old search code. */
export const LISTING_NO_SHAPE = /^(?:EP-?\d{3,8}|[A-Za-z][- ]?\d{6})(?:-R)?$/i;

export type OldSearchRedirect = { href: string; status: 301 | 302 };

function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

/**
 * null unless `param` matches OLD_SEARCH_CODE and not LISTING_NO_SHAPE.
 * A registry estate with a page (matched on nameZh, nameEn or any alias,
 * case-insensitive, NFKC) 301s to that page; any other name 302s to a
 * keyword search, since the listings behind it change over time.
 */
export function resolveOldSearchCode(param: string): OldSearchRedirect | null {
  if (LISTING_NO_SHAPE.test(param)) return null;
  const match = OLD_SEARCH_CODE.exec(param);
  if (!match) return null;
  const name = match[1].trim();
  if (!name) return null;
  const wanted = normalizeName(name);
  const estate = estateRegistry.find(
    (entry) =>
      entry.hasPage &&
      [entry.nameZh, entry.nameEn, ...entry.aliases].some(
        (candidate) => candidate != null && normalizeName(candidate) === wanted,
      ),
  );
  if (estate) return { href: `/estate/${estate.slug}`, status: 301 };
  return { href: `/listings?keyword=${encodeURIComponent(name)}`, status: 302 };
}
