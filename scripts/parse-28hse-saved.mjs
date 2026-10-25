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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const capture = resolve(process.argv[2] ?? "/workspace/28hse_capture");
  const rows = new Map(
    parseSavedIndex(readFileSync(resolve(capture, "buy_p1.html"), "utf8")).map((row) => [
      row.id,
      row,
    ]),
  );
  for (const line of readFileSync(resolve(capture, "urls.txt"), "utf8").split("\n")) {
    const [filename, url] = line.trim().split(/\s+/);
    if (!/^detail_(buy|rent)_\d+\.html$/.test(filename ?? "")) continue;
    const detail = parseSavedDetail(
      readFileSync(resolve(capture, filename), "utf8"),
      url,
      filename,
    );
    const previous = rows.get(detail.id);
    rows.set(detail.id, { ...detail, source_files: [...(previous?.source_files ?? []), filename] });
  }
  const listings = [...rows.values()];
  const fixture = {
    source: "Saved 28hse HTML; preview only, not live inventory",
    rent_coverage: "Three saved detail pages only; rent index was not captured",
    listings,
  };
  writeFileSync(resolve("src/content/28hse-preview.json"), JSON.stringify(fixture, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        count: listings.length,
        sale: listings.filter((x) => x.deal_type === "sale").length,
        rent: listings.filter((x) => x.deal_type === "rent").length,
        missing: listings
          .map((x) => ({
            id: x.id,
            fields: Object.keys(x).filter(
              (key) => x[key] === null && key !== (x.deal_type === "sale" ? "rent" : "price"),
            ),
          }))
          .filter((x) => x.fields.length),
      },
      null,
      2,
    ),
  );
}
