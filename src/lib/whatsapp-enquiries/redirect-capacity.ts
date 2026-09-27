import { createHash } from "node:crypto";

export type RedirectCapacity = {
  globalShards: number;
  globalPerShardPerMinute: number;
  registeredPerLinkPerMinute: number;
};
function bounded(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
export function redirectCapacity(env: NodeJS.ProcessEnv = process.env): RedirectCapacity {
  return {
    globalShards: 32,
    globalPerShardPerMinute: bounded(env.EP_WA_REDIRECT_GLOBAL_SHARD_PER_MIN, 5000, 300, 50000),
    registeredPerLinkPerMinute: bounded(env.EP_WA_REDIRECT_LINK_PER_MIN, 600, 100, 10000),
  };
}
export function redirectBucketKey(kind: "global" | "registered", identity: string, shards = 32) {
  const shard =
    kind === "global"
      ? createHash("sha256").update(identity).digest().readUInt32BE(0) % shards
      : identity;
  return createHash("sha256")
    .update("wa-redirect:" + kind + ":" + shard)
    .digest("hex");
}
/** Stale counters are only retention data. Prune a bounded page after active traffic. */
export async function maybePruneRedirectBuckets(
  query: (sql: string) => Promise<unknown>,
  globalCount: number,
): Promise<boolean> {
  if (globalCount < 1000 || globalCount % 1000 !== 0) return false;
  try {
    await query(`WITH expired AS (
      SELECT bucket_key FROM whatsapp_link_rate_buckets
      WHERE window_start < now() - interval '1 day'
      ORDER BY window_start
      LIMIT 1000
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM whatsapp_link_rate_buckets AS current
    USING expired
    WHERE current.bucket_key = expired.bucket_key
      AND current.window_start < now() - interval '1 day'`);
    return true;
  } catch {
    console.warn("WA_REDIRECT_BUCKET_PRUNE_FAILED");
    return false;
  }
}

export function redirectCapacityDecision(
  globalCount: number,
  linkCount: number | null,
  config: RedirectCapacity,
) {
  if (globalCount > config.globalPerShardPerMinute) return "global_limited" as const;
  if (linkCount != null && linkCount > config.registeredPerLinkPerMinute)
    return "link_limited" as const;
  return "allowed" as const;
}
