/**
 * Remove expired counters only as part of an already active request.
 * The index on window_start keeps this bounded even after long idle periods.
 */
const PRUNE_SQL = `WITH expired AS (
  SELECT bucket FROM rate_limits
  WHERE window_start < now() - interval '1 day'
  ORDER BY window_start
  LIMIT 1000
  FOR UPDATE SKIP LOCKED
)
DELETE FROM rate_limits AS current
USING expired
WHERE current.bucket = expired.bucket
  AND current.window_start < now() - interval '1 day'`;

export async function maybePruneExpiredRateLimitBuckets(
  query: (statement: string) => Promise<unknown>,
  shouldPrune: () => boolean = () => Math.random() < 0.01,
): Promise<boolean> {
  if (!shouldPrune()) return false;
  try {
    await query(PRUNE_SQL);
    return true;
  } catch {
    // Retention maintenance must not turn a valid visitor request into an error.
    console.warn("[rate-limit] Expired bucket cleanup failed.");
    return false;
  }
}
