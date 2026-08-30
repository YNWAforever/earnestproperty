/**
 * P4 Task 6 (docs/superpowers/plans/2026-08-30-frontend-revamp-p4-areas-estates.md):
 * pure hub-page composition logic for castle-peak-road.index.tsx, kept in its
 * own plain .ts module (no JSX) so it can be imported and actually executed
 * under Node's native TS stripping -- matching estate-comparison.ts (Task 5)
 * and estate-registry.ts/castle-peak-road.ts's own established split between
 * pure logic and the .tsx that renders it. castle-peak-road.index.tsx imports
 * this module and handles nothing but JSX.
 *
 * Local, minimal types (InventoryLike / TransactionLike) stand in for
 * queries.ts's CorridorInventory / DistrictTransaction on purpose: queries.ts
 * pulls in server-only Neon/TanStack Start machinery that would break this
 * module's "importable under plain node --test" property if imported
 * directly, even as a type-only import. castle-peak-road.index.tsx still
 * passes the real queries.ts values when calling these functions -- the
 * structural shapes below are a strict subset, so real values satisfy them.
 */
import { getEstateEntry } from "../../content/estate-registry.ts";
import type { CorridorSegment } from "../../content/castle-peak-road.ts";

export type EstateDirectoryEntry = {
  slug: string;
  nameZh: string;
  nameEn: string | null;
  hasPage: boolean;
};

/**
 * Estates the registry claims as this segment's own DB-joinable inventory
 * (`segment.estateSlugs`, itself derived in castle-peak-road.ts from
 * estate-registry.ts's `corridorSegment` field). Deliberately NOT
 * `featuredEstates`/`textAliases`, which mix in non-DB-backed display names
 * and place names -- see estate-registry.ts's own header comment on why
 * those stay separate curated arrays.
 *
 * Today this returns [] for "ting-kau": none of that zone's estates
 * (海雲軒/縉皇居, or any of the 17-estate expansion) carry a real, published
 * `corridorSegment: "ting-kau"` row yet -- every one of them ships
 * `published = false` with no facts (Task 2). It returns the 5 `hasPage:
 * true` estates for "sham-tseng", since those are the only registry entries
 * with `corridorSegment` set today. An empty directory for one segment is
 * the correct, current state to render gracefully -- not a bug to paper over
 * by inventing corridor membership that doesn't exist in the registry.
 */
export function estateDirectoryForSegment(
  segment: CorridorSegment,
): EstateDirectoryEntry[] {
  return segment.estateSlugs.map((slug) => {
    const entry = getEstateEntry(slug);
    return {
      slug: entry.slug,
      nameZh: entry.nameZh,
      nameEn: entry.nameEn,
      hasPage: entry.hasPage,
    };
  });
}

export type InventoryLike = { saleTotal: number; rentTotal: number };

export type InventorySummary = {
  saleTotal: number;
  rentTotal: number;
  total: number;
  scopeLabel: string;
};

/**
 * Replaces the hub's old combined `{segmentTotal} 個即時放盤` figure with an
 * explicit sale/rent breakdown plus a scope label naming the segment, so a
 * reader can't mistake the count for corridor-wide inventory when it is
 * actually scoped to just this segment's own districts/estates/aliases.
 */
export function summarizeSegmentInventory(
  segment: CorridorSegment,
  inventory: InventoryLike | undefined,
): InventorySummary {
  const saleTotal = inventory?.saleTotal ?? 0;
  const rentTotal = inventory?.rentTotal ?? 0;
  return {
    saleTotal,
    rentTotal,
    total: saleTotal + rentTotal,
    scopeLabel: `只計算${segment.nameZh}範圍即時放盤`,
  };
}

export type AreaComparisonRowKey =
  | "housingProfile"
  | "buyerFit"
  | "transport"
  | "schoolNet";

export type AreaComparisonRow = {
  key: AreaComparisonRowKey;
  label: string;
  values: Record<string, string>;
};

const AREA_COMPARISON_FIELDS: Array<{
  key: AreaComparisonRowKey;
  label: string;
}> = [
  { key: "housingProfile", label: "主要住宅類型" },
  { key: "buyerFit", label: "適合買家" },
  { key: "transport", label: "交通" },
  { key: "schoolNet", label: "校網" },
];

/**
 * Rows = each segment's own curated copy field (housingProfile / buyerFit /
 * transport / schoolNet), columns = segments. Every cell is that segment's
 * field value verbatim -- no paraphrasing into new copy -- except a missing
 * `schoolNet` (optional on CorridorSegment), which falls back to an explicit
 * "—" rather than an empty cell or a fabricated net code.
 */
export function buildAreaComparisonRows(
  segments: CorridorSegment[],
): AreaComparisonRow[] {
  return AREA_COMPARISON_FIELDS.map(({ key, label }) => ({
    key,
    label,
    values: Object.fromEntries(
      segments.map((segment) => [segment.slug, segment[key] ?? "—"]),
    ),
  }));
}

/**
 * A quality/audience phrase list extracted from a segment's own `buyerFit`
 * sentence, for the "邊個區適合我？" decision guide. Every returned string is
 * a literal substring of the input -- only a fixed "適合" prefix, the
 * trailing "的...。" audience clause, and the "、"/"和" delimiters are
 * stripped -- so this restructures existing copy into a scannable list
 * rather than asserting anything new about the area. See this module's test
 * for a substring-containment check proving that against both live
 * segments' real `buyerFit` text.
 */
export function buyerFitHighlights(buyerFit: string): string[] {
  const withoutPrefix = buyerFit.startsWith("適合")
    ? buyerFit.slice(2)
    : buyerFit;
  const lastDe = withoutPrefix.lastIndexOf("的");
  const qualities =
    lastDe === -1 ? withoutPrefix : withoutPrefix.slice(0, lastDe);
  return qualities
    .split(/[、和]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export type TransactionLike = {
  deal_date: string | null;
  saleable_psf: number | null;
};

export type PriceSnapshot = {
  latestPsf: number;
  latestMonth: string;
  transactionCount: number;
};

/**
 * The same monthly-average aggregation district.sham-tseng.tsx's
 * `aggregateByMonth` already uses over real transaction data, reused here
 * rather than reimplemented from scratch, then reduced to just the most
 * recent month's average -- a "snapshot" figure, not a full per-segment
 * trend chart (two full charts on one hub page would be a bigger addition
 * than this task's scope; see the route's own comment on this trade-off).
 * Returns `null` when there is no real transaction data to summarize, so the
 * caller can omit the section for that segment entirely rather than render a
 * fabricated figure.
 */
export function computePriceSnapshot(
  transactions: TransactionLike[],
): PriceSnapshot | null {
  const buckets = new Map<string, { sum: number; n: number }>();
  for (const row of transactions) {
    if (!row.deal_date || !row.saleable_psf) continue;
    const key = row.deal_date.slice(0, 7); // YYYY-MM
    const bucket = buckets.get(key) ?? { sum: 0, n: 0 };
    bucket.sum += Number(row.saleable_psf);
    bucket.n += 1;
    buckets.set(key, bucket);
  }
  if (buckets.size === 0) return null;

  const months = Array.from(buckets.keys()).sort();
  const latestKey = months[months.length - 1];
  const latestBucket = buckets.get(latestKey);
  if (!latestBucket) return null;
  const transactionCount = Array.from(buckets.values()).reduce(
    (sum, b) => sum + b.n,
    0,
  );

  return {
    latestPsf: Math.round(latestBucket.sum / latestBucket.n),
    latestMonth: latestKey.slice(2).replace("-", "/"),
    transactionCount,
  };
}
