// Each public search route's schema defaults. stripSearchParams() removes a
// search value equal to its default, so the canonical href TanStack Start
// compares against (and 307s to) is the bare URL, not ?deal=all&sort=newest&page=1.
export const LISTINGS_SEARCH_DEFAULTS = { deal: "all", sort: "newest", page: 1 } as const;
export const VIDEOS_SEARCH_DEFAULTS = { sort: "newest" } as const;
export const TRANSACTIONS_SEARCH_DEFAULTS = { dealType: "all", page: 1 } as const;
