/**
 * True only when `Authorization` is exactly `Bearer <secret>`. An empty or missing
 * secret always refuses. Compares SHA-256 digests with `equal`, which defaults to
 * the Workers runtime's `crypto.subtle.timingSafeEqual`.
 */
export function hasBearerSecret(
  request: Request,
  secret: string | null | undefined,
  equal?: (a: ArrayBuffer, b: ArrayBuffer) => boolean,
): Promise<boolean>;
