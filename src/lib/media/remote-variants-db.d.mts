import type { VariantSet } from "./remote-variants.mjs";
export type MediaVariantQuery = (statement: string, params: unknown[]) => Promise<unknown>;
export declare function findMediaVariantSet(
  query: MediaVariantQuery,
  assetId: string,
  sourceHash: string,
): Promise<VariantSet | null>;
export declare function saveMediaVariantSet(
  query: MediaVariantQuery,
  set: VariantSet,
): Promise<VariantSet>;
export declare function lookupMediaVariantsForUrls(
  query: MediaVariantQuery,
  urls: string[],
): Promise<Record<string, VariantSet>>;
