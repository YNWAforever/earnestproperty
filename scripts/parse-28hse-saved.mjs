// Offline only: no requests, credentials, or database access.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { load } from "cheerio";
import { normalizeText, parseMoneyToHkd, parseRoomCounts } from "../src/lib/mls/parse-old-site.mjs";

const text = (value) => normalizeText(value) || null;
const area = (value) => {
  const match = String(value ?? "").match(/([\d,]+)\s*(?:平方)?呎/);
  return match ? Number(match[1].replaceAll(",", "")) : null;
};
const image = (value) => (/^https:\/\/i[0-9]+\.28hse\.com\//.test(value ?? "") ? value : null);
const id = (url) => url.match(/property-(\d+)$/)?.[1];

export function parseSavedIndex(html) {
  const $ = load(html);
  const rows = new Map();
  $(".property_item").each((_, element) => {
    const card = $(element);
    const sourceUrl = card.find("a.detail_page").first().attr("href");
    if (!/^https:\/\/www\.28hse\.com\/buy\/apartment\/property-\d+$/.test(sourceUrl ?? "")) return;
    const location = card.find(".district_area a");
    rows.set(id(sourceUrl), {
      id: id(sourceUrl),
      deal_type: "sale",
      title_zh: text(card.find(".header a").text()),
      estate: text(location.eq(1).text()),
      district: text(location.eq(0).text()),
      price: parseMoneyToHkd(card.find(".extra .red.label").text()),
      rent: null,
      saleable_area: area(
        card
          .find(".areaUnitPrice")
          .text()
          .match(/實用面積[^@]+/)?.[0],
      ),
      bedrooms: parseRoomCounts(
        card
          .find(".tagLabels")
          .text()
          .replace(/(\d)\s+房/g, "$1房"),
      ).bedrooms,
      main_image_url: image(card.find("img.detail_page_img").first().attr("src")),
      source_url: sourceUrl,
      source_files: ["buy_p1.html"],
    });
  });
  if (!rows.size) throw new Error("No saved sale cards found; check the HTML template");
  return [...rows.values()];
}

export function parseSavedDetail(html, sourceUrl, filename) {
  if (!/^https:\/\/www\.28hse\.com\/(buy|rent)\/apartment\/property-\d+$/.test(sourceUrl))
    throw new Error("Invalid source URL");
  const $ = load(html);
  const deal = sourceUrl.includes("/rent/") ? "rent" : "sale";
  const values = new Map();
  $("tr[data-key]").each((_, row) => {
    values.set(
      text($(row).find("td").first().text()),
      text($(row).find(".pairValue").first().text()),
    );
  });
  const crumbs = $(".c_breadcrumb li")
    .map((_, row) => text($(row).find('[itemprop="name"]').text()))
    .get();
  // JSON-LD numberOfRooms is inconsistent with the visible bedroom table;
  // use the labelled table for room counts and area, JSON-LD only for the cover.
  let cover = null;
  $('script[type="application/ld+json"]').each((_, node) => {
    const data = JSON.parse($(node).text());
    if (data.primaryImageOfPage) cover = image(data.primaryImageOfPage.url);
  });
  if (!$("h1").length || !values.size) throw new Error(`Unrecognized detail template: ${filename}`);
  return {
    id: id(sourceUrl),
    deal_type: deal,
    title_zh: text($("h1").first().text()),
    estate: crumbs[4] ?? null,
    district: crumbs[3] ?? null,
    price: deal === "sale" ? parseMoneyToHkd(values.get("售價")) : null,
    rent: deal === "rent" ? parseMoneyToHkd(values.get("每月租金") ?? values.get("租金")) : null,
    saleable_area: area(values.get("實用面積")),
    bedrooms: parseRoomCounts(values.get("房間及浴室")?.replace(/(\d)\s+房/g, "$1房")).bedrooms,
    main_image_url: cover,
    source_url: sourceUrl,
    source_files: [filename],
  };
}

// The supplied comparison is authoritative: never infer new inventory from HTML.
export function selectNewListings(entries, savedCards) {
  const cards = new Map(savedCards.map((row) => [row.id, row]));
  const seen = new Set();
  const listings = [];
  for (const entry of entries) {
    if (entry.status !== "NEW" || entry.match_listing_no || entry.match_url) continue;
    if (entry.deal_type !== "sale") throw new Error("Expected new for-sale flats only");
    const sourceId = String(entry.hse_id);
    if (seen.has(sourceId)) continue;
    const duplicateIds = String(entry.duplicate_of_28hse_ids ?? "")
      .split(/[,;\s]+/)
      .filter(Boolean);
    const aliases = [sourceId, ...duplicateIds];
    if (aliases.some((alias) => seen.has(alias))) continue;
    const card = cards.get(sourceId);
    if (!card || card.source_url !== entry.source_url)
      throw new Error(`Missing saved card for ${sourceId}`);
    for (const alias of aliases) seen.add(alias);
    listings.push({
      id: sourceId,
      deal_type: entry.deal_type,
      title_zh: entry.title ?? null,
      estate: entry.estate ?? null,
      district: entry.district ?? null,
      unit_desc: entry.unit_desc ?? null,
      price: entry.price ?? null,
      rent: entry.rent ?? null,
      saleable_area: entry.saleable_area ?? null,
      bedrooms: entry.bedrooms ?? null,
      main_image_url: card.main_image_url,
      source_url: entry.source_url,
      source_files: ["new_listings.json", "buy_p1.html"],
      duplicate_source_ids: duplicateIds,
    });
  }
  return listings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const capture = resolve(process.argv[2] ?? "/workspace/28hse_capture");
  const entries = JSON.parse(readFileSync(resolve(capture, "new_listings.json"), "utf8"));
  const cards = parseSavedIndex(readFileSync(resolve(capture, "buy_p1.html"), "utf8"));
  const listings = selectNewListings(entries, cards);
  const fixture = {
    source: "Only NEW entries from supplied new_listings.json; saved HTML supplies images only",
    comparison:
      "compare.csv: existing and uncertain matches excluded; explicit duplicate IDs merged",
    rent_coverage: "No new rental listings in the supplied allowlist",
    listings,
  };
  writeFileSync(resolve("src/content/28hse-preview.json"), JSON.stringify(fixture, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        count: listings.length,
        estates: listings.map((row) => row.estate),
        missing: listings.flatMap((row) =>
          Object.entries(row)
            .filter(([key, value]) => value === null && key !== "rent")
            .map(([key]) => `${row.id}:${key}`),
        ),
      },
      null,
      2,
    ),
  );
}
