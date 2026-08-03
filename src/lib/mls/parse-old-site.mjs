import { load } from "cheerio";

export function normalizeText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function absoluteUrl(href, baseUrl) {
  return new URL(href, baseUrl).toString();
}

export function parseListingIndex(html, baseUrl) {
  const $ = load(html);
  const links = $("a[href]")
    .map((_, anchor) => $(anchor).attr("href"))
    .get()
    .filter((href) => href && /\/property-detail\/\d+\.html$/i.test(href))
    .map((href) => absoluteUrl(href, baseUrl));

  return [...new Set(links)];
}

export function parseMaxListingPage(html) {
  const matches = [...String(html ?? "").matchAll(/findForm_submit\(["']page["']\s*,\s*(\d+)\)/g)];
  const pages = matches.map((match) => Number(match[1])).filter(Number.isFinite);
  return pages.length ? Math.max(...pages) : 1;
}

export function buildPagedListingUrl(sourceUrl, page) {
  const url = new URL(sourceUrl);
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

export function parseMoneyToHkd(text) {
  const raw = normalizeText(text).replace(/,/g, "");
  if (!raw || raw === "--") return null;

  // 億 = 100,000,000. Handle combined forms like X億Y萬 (e.g. 1億2,800萬).
  const hundredMillion = raw.match(/(\d+(?:\.\d+)?)\s*億(?:\s*(\d+(?:\.\d+)?)\s*萬)?/);
  if (hundredMillion) {
    const yi = Number(hundredMillion[1]) * 100_000_000;
    const wan = hundredMillion[2] ? Number(hundredMillion[2]) * 10_000 : 0;
    const total = yi + wan;
    return Number.isFinite(total) ? Math.round(total) : null;
  }

  const tenThousand = raw.match(/\$?\s*(\d+(?:\.\d+)?)\s*萬/);
  if (tenThousand) return Math.round(Number(tenThousand[1]) * 10_000);

  const amount = raw.match(/\$?\s*(\d+(?:\.\d+)?)/);
  if (!amount) return null;

  const value = Number(amount[1]);
  return Number.isFinite(value) ? Math.round(value) : null;
}

export function parseAreaFeet(text) {
  const match = normalizeText(text).match(/([\d,]+)\s*呎/);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

export function parseRoomCounts(text) {
  const raw = normalizeText(text);
  if (!raw) return { bedrooms: null, livingRooms: null };
  if (raw.includes("開放式")) return { bedrooms: 0, livingRooms: null };

  const bedrooms = raw.match(/(\d+)房/);
  const livingRooms = raw.match(/(\d+)廳/);

  return {
    bedrooms: bedrooms ? Number(bedrooms[1]) : null,
    livingRooms: livingRooms ? Number(livingRooms[1]) : null,
  };
}

export function parseDetailTable($) {
  const fields = {};

  $("tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 2) return;

    const key = normalizeText($(cells[0]).text());
    const value = normalizeText($(cells[1]).text());
    if (key && key !== "項目") fields[key] = value;
  });

  return fields;
}

function extractLegacyDetailId(sourceUrl) {
  return sourceUrl.match(/property-detail\/(\d+)\.html/i)?.[1] ?? null;
}

function metaContent($, selector) {
  return normalizeText($(selector).attr("content"));
}

function extractLegacyPropertyNo($) {
  const bodyMatch = normalizeText($("body").text()).match(/物業編號:\s*([A-Z0-9-]+)/i);
  if (bodyMatch) return bodyMatch[1];

  const description =
    metaContent($, "meta[name='description']") || metaContent($, "meta[property='og:description']");
  return description.match(/#([A-Z0-9-]+)/i)?.[1] ?? null;
}

function extractImageUrls($) {
  const urls = [];

  $("meta[property='og:image'], img[src]").each((_, node) => {
    const raw = $(node).attr("content") ?? $(node).attr("src");
    if (!raw || !/imgs\.property\.hk\/(largePhotos|midPhotos|bigPhotos)/i.test(raw)) return;

    const url = raw.startsWith("//") ? `https:${raw}` : raw;
    urls.push(url.replace("/midPhotos/", "/largePhotos/").replace("/bigPhotos/", "/largePhotos/"));
  });

  return [...new Set(urls)];
}

function extractLegacyImageUrls($) {
  const urls = [];

  $("img[src]").each((_, node) => {
    const raw = $(node).attr("src");
    if (!raw || !/imgs\.property\.hk|midPhotos|bigPhotos/i.test(raw)) return;
    urls.push(raw.startsWith("//") ? `https:${raw}` : raw);
  });

  return [...new Set(urls)];
}

export function splitFeatureText(text) {
  return normalizeText(text)
    .split(/[,，、]/)
    .map(normalizeText)
    .filter(Boolean);
}

function extractTitleParts(title) {
  const withoutBrand = normalizeText(title).replace(
    /\s*-\s*(晉誠地產|Earnest Property Agency)\s*$/i,
    "",
  );
  const parts = withoutBrand.split(",").map(normalizeText).filter(Boolean);

  return {
    titleZh: parts[0] ?? "",
    districtZh: parts[1] ?? "",
    propertyNo: parts.join(",").match(/#([A-Z0-9-]+)/i)?.[1] ?? null,
  };
}

function extractWhatsappPhone($) {
  const href = $("a[href*='whatsapp.com/send'], a[href*='api.whatsapp.com/send']")
    .first()
    .attr("href");
  return href?.match(/[?&]phone=(\d+)/)?.[1] ?? null;
}

export function parseListingDetail(html, sourceUrl) {
  const $ = load(html);
  const fields = parseDetailTable($);
  const roomText = fields["間格"] || fields["間隔"] || null;
  const roomCounts = parseRoomCounts(roomText);

  return {
    sourceUrl,
    legacyDetailId: extractLegacyDetailId(sourceUrl),
    legacyPropertyNo: extractLegacyPropertyNo($),
    title: normalizeText($("title").first().text()),
    metaDescription:
      metaContent($, "meta[name='description']") ||
      metaContent($, "meta[property='og:description']"),
    ogImage: $("meta[property='og:image']").attr("content") ?? null,
    sourceUpdatedAt: fields["更新日期"] || null,
    propertyUse: fields["物業用途"] || null,
    districtName: fields["地區"] || null,
    streetEn: fields["街道 (英)"] || null,
    streetZh: fields["街道 (中)"] || null,
    buildingEn: fields["大廈 (英)"] || null,
    buildingZh: fields["大廈 (中)"] || null,
    floor: fields["層數"] || null,
    unit: fields["單位"] || null,
    grossArea: parseAreaFeet(fields["建築面積"]),
    saleableArea: parseAreaFeet(fields["實用面積"]),
    salePriceHkd: parseMoneyToHkd(fields["售價"]),
    rentHkd: parseMoneyToHkd(fields["出租價"]),
    orientation: fields["座向景觀"] || fields["座向"] || null,
    decoration: fields["裝修"] || null,
    remarks: fields["備註"] || null,
    contactName: fields["聯絡人"] || null,
    contactPhone: fields["聯絡電話"] || null,
    bedrooms: roomCounts.bedrooms,
    livingRooms: roomCounts.livingRooms,
    roomText,
    images: extractImageUrls($),
  };
}

export const parseMoney = parseMoneyToHkd;
export const parseArea = parseAreaFeet;

export function parseLegacyDetail(html, url) {
  const $ = load(html);
  const detail = parseListingDetail(html, url);
  const titleParts = extractTitleParts(detail.title);
  const legacyPropertyNo = detail.legacyPropertyNo ?? titleParts.propertyNo;
  const titleZh = detail.buildingZh || titleParts.titleZh;

  return {
    legacyDetailId: detail.legacyDetailId,
    legacyUrl: detail.sourceUrl,
    legacyPropertyNo,
    titleZh,
    districtZh: detail.districtName || titleParts.districtZh,
    dealType: detail.salePriceHkd ? "sale" : "rent",
    price: detail.salePriceHkd,
    rent: detail.rentHkd,
    saleableArea: detail.saleableArea,
    grossArea: detail.grossArea,
    orientation: detail.orientation,
    features: splitFeatureText(detail.roomText),
    description: detail.metaDescription,
    images: extractLegacyImageUrls($),
    whatsappPhone: extractWhatsappPhone($),
    sourceUpdatedAt: detail.sourceUpdatedAt,
    sourceLanguage: url.includes("/eng/") ? "en" : "tc",
  };
}
