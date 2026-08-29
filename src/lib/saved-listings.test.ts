import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  addFavourite,
  deleteSavedSearch,
  getFavourites,
  getSavedSearches,
  isFavourited,
  removeFavourite,
  saveSearch,
  toggleFavourite,
} from "./saved-listings";

/**
 * `saved-listings.ts` follows LiveAgentWidget.tsx's established
 * `window.localStorage` shape (see readOrCreateAnonymousId, lines ~267-281
 * there) -- there is no jsdom/happy-dom in this repo's bun:test setup, so
 * `window` is undefined by default. We install a plain in-memory Storage
 * stand-in on `globalThis.window` before each test and remove it after, so
 * every test starts from a clean slate and the "no window" (SSR) case can
 * also be exercised on demand.
 */
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) =>
      store.has(key) ? (store.get(key) as string) : null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

beforeEach(() => {
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: createMemoryStorage(),
  };
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("favourites", () => {
  test("favouriting a listing_no persists it", () => {
    expect(getFavourites()).toEqual([]);
    addFavourite("B059390");
    expect(getFavourites()).toEqual(["B059390"]);
    expect(isFavourited("B059390")).toBe(true);
  });

  test("a duplicate favourite call doesn't duplicate the entry", () => {
    addFavourite("B059390");
    addFavourite("B059390");
    expect(getFavourites()).toEqual(["B059390"]);
  });

  test("un-favouriting removes it", () => {
    addFavourite("B059390");
    addFavourite("A100200");
    removeFavourite("B059390");
    expect(getFavourites()).toEqual(["A100200"]);
    expect(isFavourited("B059390")).toBe(false);
  });

  test("toggleFavourite flips membership each call", () => {
    expect(toggleFavourite("A1")).toEqual(["A1"]);
    expect(isFavourited("A1")).toBe(true);
    expect(toggleFavourite("A1")).toEqual([]);
    expect(isFavourited("A1")).toBe(false);
  });
});

describe("saved searches", () => {
  test("saving a search persists params and a timestamp", () => {
    const entry = saveSearch("深井 · 售盤 · 2 房", {
      deal: "sale",
      district: "sham-tseng",
      bedrooms: 2,
    });
    expect(entry.label).toBe("深井 · 售盤 · 2 房");
    expect(entry.params).toEqual({
      deal: "sale",
      district: "sham-tseng",
      bedrooms: 2,
    });
    expect(typeof entry.savedAt).toBe("string");
    expect(Number.isNaN(Date.parse(entry.savedAt))).toBe(false);

    const stored = getSavedSearches();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual(entry);
  });

  test("saved searches are ordered newest-first (most-recently-saved first)", () => {
    saveSearch("first", {});
    saveSearch("second", {});
    saveSearch("third", {});
    expect(getSavedSearches().map((s) => s.label)).toEqual([
      "third",
      "second",
      "first",
    ]);
  });

  test("deleting one removes only that one", () => {
    const a = saveSearch("a", {});
    const b = saveSearch("b", {});
    const c = saveSearch("c", {});
    deleteSavedSearch(b.id);
    const remainingIds = getSavedSearches().map((s) => s.id);
    expect(remainingIds).toContain(a.id);
    expect(remainingIds).toContain(c.id);
    expect(remainingIds).not.toContain(b.id);
    expect(remainingIds).toHaveLength(2);
  });

  test("the 20-item cap evicts the oldest entry on overflow, not a random one", () => {
    for (let i = 0; i < 21; i++) {
      saveSearch(`search-${i}`, { page: i });
    }
    const results = getSavedSearches();
    expect(results).toHaveLength(20);
    // search-0 was saved first, so it's the oldest -- it must be the one
    // evicted, not e.g. search-10 or anything else in the middle.
    expect(results.some((r) => r.label === "search-0")).toBe(false);
    // Every other entry (1 through 20) must have survived.
    for (let i = 1; i <= 20; i++) {
      expect(results.some((r) => r.label === `search-${i}`)).toBe(true);
    }
    // Still ordered newest-first after the eviction.
    expect(results[0]?.label).toBe("search-20");
  });
});

describe("localStorage failures degrade gracefully", () => {
  test("a getItem/setItem that throws never throws out of any exported function", () => {
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: () => {
          throw new Error("storage blocked");
        },
        setItem: () => {
          throw new Error("storage blocked");
        },
        removeItem: () => {
          throw new Error("storage blocked");
        },
      },
    };

    expect(() => getFavourites()).not.toThrow();
    expect(getFavourites()).toEqual([]);
    expect(() => isFavourited("X")).not.toThrow();
    expect(() => addFavourite("X")).not.toThrow();
    expect(() => removeFavourite("X")).not.toThrow();
    expect(() => toggleFavourite("X")).not.toThrow();

    expect(() => getSavedSearches()).not.toThrow();
    expect(getSavedSearches()).toEqual([]);
    expect(() => saveSearch("x", {})).not.toThrow();
    expect(() => deleteSavedSearch("nonexistent")).not.toThrow();
  });

  test("no window at all (SSR) also degrades to empty reads and no-op writes", () => {
    delete (globalThis as unknown as { window?: unknown }).window;

    expect(() => getFavourites()).not.toThrow();
    expect(getFavourites()).toEqual([]);
    expect(() => addFavourite("X")).not.toThrow();
    expect(() => getSavedSearches()).not.toThrow();
    expect(getSavedSearches()).toEqual([]);
    expect(() => saveSearch("x", {})).not.toThrow();
  });

  test("malformed JSON already in storage is treated as empty rather than throwing", () => {
    const storage = createMemoryStorage();
    storage.setItem("earnest-saved-favourites", "{not valid json");
    storage.setItem("earnest-saved-searches", "[[[");
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: storage,
    };

    expect(() => getFavourites()).not.toThrow();
    expect(getFavourites()).toEqual([]);
    expect(() => getSavedSearches()).not.toThrow();
    expect(getSavedSearches()).toEqual([]);
  });
});
