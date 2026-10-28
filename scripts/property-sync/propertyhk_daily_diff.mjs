import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { diffPriceStatus, parseArgs, saveReport } from "./price_status_diff.mjs";
import { detailIdentity } from "./propertyhk_detail_browser.mjs";
import { normalizeDecimal } from "../../src/lib/mls/ingestion-contract.mjs";

export function requiredDetailUrls(index, current) {
  if (
    index?.schema !== "propertyhk-index/v1" ||
    index.complete !== true ||
    index.absence_enabled !== false ||
    !Array.isArray(index.ads) ||
    !Array.isArray(current.properties)
  )
    throw Error("incomplete_index");
  const ids = new Set();
  for (const ad of index.ads) {
    if (detailIdentity(ad.detail_url) !== ad.property_id || ids.has(ad.property_id))
      throw Error("invalid_index_identity");
    ids.add(ad.property_id);
  }
  // Confirm every existing link as well as new ads: index presence alone cannot verify lifecycle.
  // Later T5 may cache unchanged details after freshness/authority policy is approved.
  return index.ads.map((ad) => ad.detail_url);
}
export function propertyhkDiff(index, current, details, options = {}) {
  requiredDetailUrls(index, current);
  if (
    details.schema !== "propertyhk-details/v1" ||
    details.complete !== true ||
    details.absence_enabled !== false ||
    !Array.isArray(details.listings)
  )
    throw Error("incomplete_details");
  const byId = new Map();
  for (const row of details.listings) {
    if (byId.has(row.property_id)) throw Error("duplicate_detail");
    byId.set(row.property_id, row);
  }
  if (byId.size !== index.ads.length || index.ads.some((ad) => !byId.has(ad.property_id)))
    throw Error("missing_detail_confirmation");
  const listings = [];
  for (const ad of index.ads) {
    const detail = byId.get(ad.property_id);
    if (detail.identity_verified !== true || !/^[a-f0-9]{64}$/.test(detail.evidence_hash ?? ""))
      throw Error("unverified_detail");
    if (
      detail.source_status === "delisted" &&
      (!Array.isArray(detail.source_status_deals) ||
        !detail.source_status_deals.length ||
        detail.source_status_deals.some((deal) => !["sale", "rent"].includes(deal)))
    )
      throw Error("detail_status_scope_missing");
    for (const deal of ["sale", "rent"]) {
      const field = deal === "sale" ? "price" : "rent";
      const linked = current.properties.some(
        (p) => p.deal_type === deal && p.source_ids?.includes(ad.property_id),
      );
      if (ad[field] == null && detail[field] == null && !linked) continue;
      if (
        detail.source_status === "delisted" &&
        (!detail.source_status_deals.includes(deal) ||
          (detail.source_status_reason === "sold" && deal === "rent") ||
          (detail.source_status_reason === "rented" && deal === "sale"))
      )
        throw Error("mixed_terminal_offers");
      if (
        detail.source_status === "active" &&
        normalizeDecimal(ad[field]) !== normalizeDecimal(detail[field])
      )
        throw Error("index_detail_amount_disagreement");
      listings.push({ ...detail, deal_type: deal });
    }
  }
  return diffPriceStatus({ scraped_at: index.scraped_at, listings }, current, {
    ...options,
    source: "propertyhk",
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const plan = process.argv[2] === "plan";
    const args = parseArgs(
      process.argv.slice(plan ? 3 : 2),
      plan ? ["index", "current", "urls"] : ["index", "current", "details", "out"],
    );
    const index = JSON.parse(await readFile(args.index, "utf8")),
      current = JSON.parse(await readFile(args.current, "utf8"));
    if (plan)
      await writeFile(
        args.urls,
        JSON.stringify(requiredDetailUrls(index, current), null, 2) + "\n",
        { flag: "wx" },
      );
    else
      await saveReport(
        propertyhkDiff(index, current, JSON.parse(await readFile(args.details, "utf8"))),
        args.out,
      );
  } catch {
    console.error("propertyhk_diff_failed_closed");
    process.exitCode = 2;
  }
}
