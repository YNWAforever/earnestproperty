// FX-13 F-22: an unmatched URL rendered the root route's home-page head, so a
// 404 carried the home title, description and og:url. The root head switches
// to this when any match is in the notFound state.

/** [owner copy] audit F-22. */
export const NOT_FOUND_TITLE = "找不到頁面｜晉誠地產";

/**
 * A child route's notFound boundary sets that match's status to "notFound".
 * When the boundary is the root route (an unmatched URL, or a loader notFound
 * that bubbles up to the root's notFoundComponent), router-core keeps the root
 * match at "success" and sets its _notFound flag instead.
 */
export function isNotFound(
  matches: ReadonlyArray<{ routeId?: string; status?: string; _notFound?: boolean }>,
): boolean {
  return matches.some((match) => match.status === "notFound" || match._notFound === true);
}

/** No description, og:url or canonical: a 404 must not claim any address. */
export function notFoundHead(): { meta: Array<Record<string, string>> } {
  return {
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: NOT_FOUND_TITLE },
      { name: "robots", content: "noindex" },
    ],
  };
}
