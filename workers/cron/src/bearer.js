// Plain JS so `node --test` imports it with no build step. No node:crypto: the
// worker has no nodejs_compat flag (wrangler.jsonc), so it uses Web Crypto only.

const encoder = new TextEncoder();

function sha256(value) {
  return crypto.subtle.digest("SHA-256", encoder.encode(value));
}

/**
 * True only when `Authorization` is exactly `Bearer <secret>`. An empty or missing
 * secret always refuses. Both sides are SHA-256 digests, so `equal` always sees two
 * 32-byte buffers and the comparison never branches on the secret's length.
 * `crypto.subtle.timingSafeEqual` is a Cloudflare Workers extension (Node lacks it,
 * so the tests inject node:crypto's timingSafeEqual).
 */
export async function hasBearerSecret(
  request,
  secret,
  equal = (a, b) => crypto.subtle.timingSafeEqual(a, b),
) {
  if (!secret) return false;
  const presented = request.headers.get("authorization") ?? "";
  const [actual, expected] = await Promise.all([sha256(presented), sha256(`Bearer ${secret}`)]);
  return equal(actual, expected);
}
