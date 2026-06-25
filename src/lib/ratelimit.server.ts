import "@tanstack/react-start/server-only";

import { getSql } from "@/lib/neon/db.server";

type RateLimitInput = {
  key: string;
  limit: number;
  windowSeconds: number;
};

/**
 * Fixed-window rate limiter backed by the rate_limits table.
 *
 * The upsert is atomic in a single round-trip: a fresh bucket (or one whose
 * window has elapsed) is (re)set to count=1 with window_start=now(); an active
 * bucket is incremented. We then compare the returned count against the limit
 * and throw a 429 Response when it is exceeded.
 */
export async function enforceRateLimit({
  key,
  limit,
  windowSeconds,
}: RateLimitInput): Promise<void> {
  const sql = getSql();
  const rows = (await sql.query(
    `INSERT INTO rate_limits (bucket, window_start, count)
     VALUES ($1, now(), 1)
     ON CONFLICT (bucket) DO UPDATE SET
       window_start = CASE
         WHEN now() - rate_limits.window_start >= make_interval(secs => $2::double precision)
           THEN now()
         ELSE rate_limits.window_start
       END,
       count = CASE
         WHEN now() - rate_limits.window_start >= make_interval(secs => $2::double precision)
           THEN 1
         ELSE rate_limits.count + 1
       END
     RETURNING count`,
    [key, windowSeconds],
  )) as Array<{ count: unknown }>;

  const count = Number(rows[0]?.count ?? 0);
  if (count > limit) {
    throw new Response("Too Many Requests", { status: 429 });
  }
}

/**
 * Derive the client IP from the standard proxy headers. We trust the first hop
 * in x-forwarded-for (Vercel rewrites this), falling back to x-real-ip, and a
 * stable sentinel when neither is present so the limiter still applies.
 */
export function clientIpFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}
