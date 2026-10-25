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

// The supplied full comparison is authoritative; never discover extra inventory here.
export function selectNewListings(entries) {
  const seen = new Set();
  return entries
    .filter(
      (entry) =>
        entry["類別 status"] === "NEW" && !entry["網站盤號 site_no"] && !entry["網站連結 site_url"],
    )
    .map((entry) => {
      const sourceId = String(entry["28hse編號 hse_id"]);
      if (!/^\d+$/.test(sourceId) || seen.has(sourceId))
        throw new Error(`Duplicate or invalid canonical ID: ${sourceId}`);
      seen.add(sourceId);
      const deal = entry["買/租 deal"];
      if (!["sale", "rent"].includes(deal)) throw new Error(`Invalid deal for ${sourceId}`);
      const sourceUrl = entry["28hse連結 source_url"];
      if (
        sourceUrl !==
        `https://www.28hse.com/${deal === "sale" ? "buy" : "rent"}/apartment/property-${sourceId}`
      )
        throw new Error(`Invalid source URL for ${sourceId}`);
      return {
        id: sourceId,
        deal_type: deal,
        title_zh: entry["標題 title"] ?? null,
        estate: entry["屋苑 estate"] ?? null,
        district: entry["地區 district"] ?? null,
        unit_desc: entry["座數/層數 unit"] ?? null,
        price: entry["售價 price"] ?? null,
        rent: entry["月租 rent"] ?? null,
        saleable_area: entry["實用面積 saleable_sqft"] ?? null,
        bedrooms: entry["房 bedrooms"] ?? null,
        main_image_url: image(entry["圖片 image_url"]),
        source_url: sourceUrl,
        posted: entry["28hse刊登 posted"] ?? null,
        source_files: ["full_new_listings.json"],
        duplicate_source_ids: String(entry["重複28hse編號 duplicate_ids"] ?? "")
          .split(/[,;\s]+/)
          .filter(Boolean),
      };
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const capture = resolve(process.argv[2] ?? "/workspace/28hse_capture");
  const entries = JSON.parse(readFileSync(resolve(capture, "full_new_listings.json"), "utf8"));
  const listings = selectNewListings(entries);
  const fixture = {
    source:
      "Only NEW entries from full_new_listings.json; reposts already merged by supplied comparison",
    comparison: "full_compare.csv: ALREADY_ON_SITE, ON_SITE_PRICE_CHANGED and UNSURE excluded",
    ordering:
      "Supplied relative posting times first (newest first); missing posting times use descending 28hse ID, not an inferred date",
    listings,
  };
  writeFileSync(resolve("src/content/28hse-preview.json"), JSON.stringify(fixture, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        count: listings.length,
        sale: listings.filter((row) => row.deal_type === "sale").length,
        rent: listings.filter((row) => row.deal_type === "rent").length,
        missing: listings.flatMap((row) =>
          ["title_zh", "estate", "district", "saleable_area", "bedrooms", "main_image_url"]
            .filter((key) => row[key] === null)
            .map((key) => `${row.id}:${key}`),
        ),
      },
      null,
      2,
    ),
  );
}
