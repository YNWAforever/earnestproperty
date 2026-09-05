import type { NeonEstateOption } from "./public-data.types";
export function createEstateOptionsCache(ttlMs = 60_000) {
  let generation = 0;
  let cached: { value: NeonEstateOption[]; expiresAt: number } | null = null;
  let pending: Promise<NeonEstateOption[]> | null = null;
  return {
    invalidate() {
      generation++;
      cached = null;
      pending = null;
    },
    async get(load: () => Promise<NeonEstateOption[]>): Promise<NeonEstateOption[]> {
      if (cached && cached.expiresAt > Date.now()) return cached.value;
      if (pending) return pending;
      const started = generation;
      const request = load()
        .then((value) => {
          if (started === generation) cached = { value, expiresAt: Date.now() + ttlMs };
          return value;
        })
        .finally(() => {
          if (started === generation) pending = null;
        });
      pending = request;
      return request;
    },
  };
}
const cache = createEstateOptionsCache();
export const invalidatePublicEstateOptions = () => cache.invalidate();
export const cachedPublicEstateOptions = (load: () => Promise<NeonEstateOption[]>) =>
  cache.get(load);
