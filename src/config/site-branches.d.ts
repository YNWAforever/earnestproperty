export type SiteBranch = {
  id: "lido" | "rhine" | "hong-kong-garden";
  name: string;
  address: string;
  phone: string;
  /** WhatsApp-capable mobile for this branch, distinct from `phone` -- the
   * three branch numbers on file today are landlines and cannot receive
   * WhatsApp. Only set once confirmed by the client. */
  whatsapp?: string | null;
  estateSlugs: string[];
  districtSlugs: string[];
  /** Shop-front photo path under `public/`, if supplied. */
  photo?: string;
  /** Intrinsic width of `photo` in pixels — the shopfronts are not all the same
   * orientation, so each card has to declare its own box. */
  photoWidth?: number;
  /** Intrinsic height of `photo` in pixels. */
  photoHeight?: number;
  /** Opening hours — only set once confirmed by the client. */
  hours?: string;
  /** Google Maps link — only set once confirmed by the client. */
  mapUrl?: string;
};

export const SITE_BRANCHES: SiteBranch[];

export function resolveBranchContact<TFallback>(input: {
  branches: SiteBranch[];
  fallback: TFallback;
  estateSlug?: string | null;
  districtSlug?: string | null;
}): SiteBranch | TFallback;
