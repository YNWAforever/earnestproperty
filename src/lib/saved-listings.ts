import { useCallback, useEffect, useState } from "react";

/**
 * Client-side-only storage for two lightweight buyer conveniences:
 * favourited listings and saved searches. Both live in localStorage --
 * there is no server fn and no DB table backing this (that's the separate,
 * server-recorded `listing_alerts` "notify me" concept). Every read/write
 * follows the ONE existing localStorage pattern in this repo
 * (readOrCreateAnonymousId in src/components/live-agent/LiveAgentWidget.tsx,
 * lines ~267-281): a plain `window.localStorage` call wrapped in try/catch,
 * degrading to an empty read / a no-op write on ANY failure -- storage
 * blocked by the browser, quota exceeded, running during SSR where `window`
 * doesn't exist at all, or corrupted JSON already sitting in the key. None
 * of that should ever throw into a render.
 */

const FAVOURITES_KEY = "earnest-saved-favourites";
const SAVED_SEARCHES_KEY = "earnest-saved-searches";

// Keeps localStorage from growing unbounded -- oldest saved search is
// evicted first once a 21st save would exceed this.
const MAX_SAVED_SEARCHES = 20;

export type SavedSearchParams = Record<string, unknown>;

export type SavedSearch = {
  id: string;
  label: string;
  params: SavedSearchParams;
  savedAt: string; // ISO 8601, also the sort key -- see getSavedSearches().
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // Covers: no `window` (SSR), storage blocked/disabled, and malformed
    // JSON already sitting in the key -- all collapse to "treat as empty".
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable, blocked, or full (quota exceeded) -- degrade to
    // a silent no-op rather than throwing out of a click handler.
  }
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `saved-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// --- Favourites --------------------------------------------------------

export function getFavourites(): string[] {
  const stored = readJson<unknown>(FAVOURITES_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((value): value is string => typeof value === "string");
}

export function isFavourited(listingNo: string): boolean {
  return getFavourites().includes(listingNo);
}

export function addFavourite(listingNo: string): string[] {
  const current = getFavourites();
  if (current.includes(listingNo)) return current;
  const next = [...current, listingNo];
  writeJson(FAVOURITES_KEY, next);
  return next;
}

export function removeFavourite(listingNo: string): string[] {
  const next = getFavourites().filter((id) => id !== listingNo);
  writeJson(FAVOURITES_KEY, next);
  return next;
}

export function toggleFavourite(listingNo: string): string[] {
  return isFavourited(listingNo)
    ? removeFavourite(listingNo)
    : addFavourite(listingNo);
}

/**
 * Tracks whether `listingNo` is favourited, exposing a `toggle()` callback.
 * Starts from `false` and syncs the real value inside a `useEffect` --
 * same hydration-safe shape as `useIsMobile()` (src/hooks/use-mobile.tsx):
 * favourite state is inherently client-only (localStorage doesn't exist
 * during SSR), so reading it during the initial render would make the
 * server-rendered markup and the client's first paint disagree. Deferring
 * the real read to an effect keeps them identical on first paint; the
 * (one-time, per-mount) re-render once the effect runs is an acceptable
 * trade for correctness.
 */
export function useFavourite(listingNo: string) {
  const [favourited, setFavourited] = useState(false);

  useEffect(() => {
    setFavourited(isFavourited(listingNo));
  }, [listingNo]);

  const toggle = useCallback(() => {
    setFavourited(toggleFavourite(listingNo).includes(listingNo));
  }, [listingNo]);

  return { favourited, toggle };
}

// --- Saved searches ------------------------------------------------------

function isSavedSearchShape(value: unknown): value is SavedSearch {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SavedSearch>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.savedAt === "string" &&
    typeof candidate.params === "object" &&
    candidate.params !== null
  );
}

/**
 * Returns saved searches newest-first, ordered by `savedAt` descending.
 * This is a deliberate, documented choice (not "insertion order" or
 * "alphabetical") -- the most recently saved search is the one a user is
 * most likely to want back.
 */
export function getSavedSearches(): SavedSearch[] {
  const stored = readJson<unknown>(SAVED_SEARCHES_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored
    .filter(isSavedSearchShape)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function saveSearch(
  label: string,
  params: SavedSearchParams,
): SavedSearch {
  const entry: SavedSearch = {
    id: generateId(),
    label,
    params,
    savedAt: new Date().toISOString(),
  };
  // Prepend the new (newest) entry ahead of the already-sorted existing
  // list, then cap -- this evicts whatever ends up last, which is always
  // the OLDEST entry given the list was newest-first before the prepend.
  const next = [entry, ...getSavedSearches()].slice(0, MAX_SAVED_SEARCHES);
  writeJson(SAVED_SEARCHES_KEY, next);
  return entry;
}

export function deleteSavedSearch(id: string): SavedSearch[] {
  const next = getSavedSearches().filter((search) => search.id !== id);
  writeJson(SAVED_SEARCHES_KEY, next);
  return next;
}
