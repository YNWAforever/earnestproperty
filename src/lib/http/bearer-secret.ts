import { createHash, timingSafeEqual } from "node:crypto";

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * True only when `Authorization` is exactly `Bearer <secret>`. An empty or missing
 * secret always refuses. SHA-256 both sides so timingSafeEqual sees equal-length
 * buffers and the comparison never branches on the secret's length.
 */
export function hasBearerSecret(request: Request, secret: string | null | undefined): boolean {
  if (!secret) return false;
  const presented = request.headers.get("authorization") ?? "";
  return timingSafeEqual(sha256(presented), sha256(`Bearer ${secret}`));
}
