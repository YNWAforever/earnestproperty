export declare const PUBLIC_CDN_CACHE: "max-age=60, stale-while-revalidate=300";

export type PublicCacheContext = {
  match: { status: string; pathname?: string };
  loaderData?: unknown;
};

export type PublicCacheOptions = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  require?: (loaderData: any) => boolean;
};

export declare function publicPageCacheHeaders(
  ctx: PublicCacheContext,
  options?: PublicCacheOptions,
): { "Vercel-CDN-Cache-Control": string } | undefined;
