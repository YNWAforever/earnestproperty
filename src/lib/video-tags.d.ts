export type EstateTag = {
  tag: string;
  district: string | null;
};

export type TagCount = EstateTag & { count: number };

/** Estate -> district, mirroring src/content/core-estates.ts. Exported for video-tags.test.mjs's anti-drift guard. */
export const ESTATE_DISTRICTS: ReadonlyMap<string, string>;

export function deriveEstateTag(title: string | null | undefined): EstateTag | null;

export function buildTagCounts(videos: ReadonlyArray<{ title?: string | null }>): TagCount[];
