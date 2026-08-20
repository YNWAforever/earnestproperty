export type EstateTag = {
  tag: string;
  district: string | null;
};

/** Estate -> district, mirroring src/content/core-estates.ts. Exported for video-tags.test.mjs's anti-drift guard. */
export const ESTATE_DISTRICTS: ReadonlyMap<string, string>;

export function deriveEstateTag(title: string | null | undefined): EstateTag | null;
