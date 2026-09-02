/**
 * Helpers behind <SiteLink> (src/components/site/SiteLink.tsx), kept out of
 * that file so it exports only a component (react-refresh/only-export-components).
 */

export type ListingsDeal = "all" | "sale" | "rent";

/**
 * Turns a `/listings?…` href into the typed search object the /listings route
 * validates. Unknown keys are dropped and bad values fall back, mirroring the
 * route's own zod fallbacks, so a stale content link can never throw.
 */
export function parseListingsSearch(href: string) {
  const [, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  const dealParam = params.get("deal");
  const deal: ListingsDeal = dealParam === "sale" || dealParam === "rent" ? dealParam : "all";
  const pageParam = Number(params.get("page") ?? 1);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
  const district = params.get("district") ?? undefined;
  const estate = params.get("estate") ?? undefined;
  const agent = params.get("agent") ?? undefined;
  const keyword = params.get("keyword") ?? undefined;

  return {
    deal,
    page,
    ...(district ? { district } : {}),
    ...(estate ? { estate } : {}),
    ...(agent ? { agent } : {}),
    ...(keyword ? { keyword } : {}),
  };
}

/** Pathname of an internal href with query string and hash removed. */
export function hrefPathname(href: string) {
  return href.split("?")[0].split("#")[0] || "/";
}

export function isExternalHref(href: string) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href);
}
