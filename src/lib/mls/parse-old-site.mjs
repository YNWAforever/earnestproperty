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
    if (!key || key === "項目") return;
    // The enquiry form further down the page repeats some labels (notably
    // 聯絡電話) with an empty value. Keep the first non-empty value rather
    // than letting a later blank row erase real detail-table data; later
    // non-empty values still win, preserving the original last-wins behaviour.
    if (!value && key in fields) return;
    fields[key] = value;
  });

  return fields;
}

/**
 * Detail-table labels we are willing to persist into `source_payload.rawFields`.
 * Kept here (rather than in the normalizer) so both the parser and the
 * normalizer agree on which raw labels exist on the legacy detail page.
 */
export const DETAIL_FIELD_LABELS = Object.freeze([
  "更新日期",
  "物業用途",
  "地區",
  "街道 (英)",
  "街道 (中)",
  "大廈 (英)",
  "大廈 (中)",
  "層數",
  "單位",
  "建築面積",
  "實用面積",
  "售價",
  "出租價",
  "呎售(建築/實用)",
  "呎租(建築/實用)",
  "入伙年份",
  "地契年期",
  "聯絡人",
  "聯絡電話",
  "座向景觀",
  "座向",
  "間格",
  "間隔",
  "裝修",
  "備註",
]);

function pickField(fields, ...labels) {
  for (const label of labels) {
    const value = fields[label];
    if (value) return value;
  }
  return null;
}

function parseYearValue(value) {
  const match = normalizeText(value).match(/(?:^|\D)(\d{4})(?:\D|$)/);
  return match ? Number(match[1]) : null;
}

function parsePsfPair(value) {
  const [grossRaw, saleableRaw] = normalizeText(value).split("/");
  return {
    gross: parseMoneyToHkd(grossRaw ?? ""),
    saleable: parseMoneyToHkd(saleableRaw ?? ""),
  };
}

function splitContactText(value) {
  return normalizeText(value)
    .split(/[,，、/]/)
    .map(normalizeText)
    .filter(Boolean);
}

/** Split 聯絡人 on comma-like separators, e.g. "VINCY 林詠斯, 海韻分行". */
export function splitContactNames(value) {
  return splitContactText(value);
}

/** Split 聯絡電話 on comma-like separators and keep digits only. */
export function splitContactPhones(value) {
  return splitContactText(value)
    .map((entry) => entry.replace(/[^\d]/g, ""))
    .filter(Boolean);
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
  const salePsf = parsePsfPair(pickField(fields, "呎售(建築/實用)", "呎售"));
  const rentPsf = parsePsfPair(pickField(fields, "呎租(建築/實用)", "呎租"));
  const contactName = fields["聯絡人"] || null;
  const contactPhone = fields["聯絡電話"] || null;

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
    salePsfGross: salePsf.gross,
    salePsfSaleable: salePsf.saleable,
    rentPsfGross: rentPsf.gross,
    rentPsfSaleable: rentPsf.saleable,
    yearCompleted: parseYearValue(pickField(fields, "入伙年份")),
    leaseExpiryYear: parseYearValue(pickField(fields, "地契年期")),
    orientation: fields["座向景觀"] || fields["座向"] || null,
    decoration: fields["裝修"] || null,
    remarks: fields["備註"] || null,
    contactName,
    contactPhone,
    contactNames: splitContactNames(contactName),
    contactPhones: splitContactPhones(contactPhone),
    bedrooms: roomCounts.bedrooms,
    livingRooms: roomCounts.livingRooms,
    layoutText: roomText,
    roomText,
    rawFields: fields,
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

/**
 * District labels that can lead the "大廈名稱" cell of the legacy listing
 * index, e.g. "荃灣&nbsp;縉皇居 第01座". Anything else is treated as the
 * building name itself instead of a district.
 */
const LISTING_DISTRICT_LABELS = Object.freeze([
  "荃灣",
  "屯門",
  "長沙灣",
  "深井",
  "汀九",
  "青龍頭",
  "馬灣",
]);

function parseListingAreaCell(value) {
  const raw = normalizeText(value);
  if (!raw || raw === "--") return null;
  const match = raw.match(/([\d,]+)\s*(?:呎|平方呎|ft)?/i);
  if (!match) return null;
  const area = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(area) && area > 0 ? area : null;
}

function parseListingCellText(cells, index) {
  return normalizeText(cells.eq(index).text());
}

function listingDistrictName(building) {
  const [firstToken] = building.split(" ").filter(Boolean);
  return firstToken && LISTING_DISTRICT_LABELS.includes(firstToken) ? firstToken : null;
}

function readListingRow($, row, seenDetailIds, baseUrl) {
  const cells = $(row).children("td");
  if (cells.length < 12) return null;

  const checkboxValue = cells.eq(0).find("input[name^='cbox' i]").attr("value");
  const detailHref = $(row).find("a[href*='/property-detail/']").first().attr("href");
  const detailId = checkboxValue || detailHref?.match(/property-detail\/(\d+)\.html/i)?.[1] || null;
  if (!detailId || !detailHref) return null;
  if (seenDetailIds.has(detailId)) return null;
  seenDetailIds.add(detailId);

  const building = parseListingCellText(cells, 4);
  const salePriceHkd = parseMoneyToHkd(parseListingCellText(cells, 8));
  const rentHkd = parseMoneyToHkd(parseListingCellText(cells, 9));
  const dealTypes = [];
  if (salePriceHkd != null) dealTypes.push("sale");
  if (rentHkd != null) dealTypes.push("rent");
  const sourceUpdatedAt = parseListingCellText(cells, 2) || null;
  const propertyUse = parseListingCellText(cells, 3) || null;
  const floor = parseListingCellText(cells, 5) || null;
  const canonicalPropertyNo = parseListingCellText(cells, 10) || null;

  return {
    detailId,
    detailUrl: absoluteUrl(detailHref, baseUrl),
    sourceUpdatedAt,
    propertyUse,
    districtName: listingDistrictName(building),
    building,
    floor,
    grossArea: parseListingAreaCell(parseListingCellText(cells, 6)),
    saleableArea: parseListingAreaCell(parseListingCellText(cells, 7)),
    salePriceHkd,
    rentHkd,
    canonicalPropertyNo,
    hasVr: /\bVR\b/i.test(parseListingCellText(cells, 1)),
    dealTypes,
  };
}

/**
 * Parse the listing-card rows of the legacy index page (`/property/`,
 * `/property/c1/`, ...). Each row carries the detail id, the card's building
 * label (district + estate), areas, both possible prices and the legacy
 * property number. Deduplicated by detail id.
 */
export function parseListingRows(html, baseUrl) {
  const $ = load(html);
  const seenDetailIds = new Set();
  const rows = [];

  $("tr").each((_, row) => {
    const parsed = readListingRow($, row, seenDetailIds, baseUrl);
    if (parsed) rows.push(parsed);
  });

  return rows;
}
