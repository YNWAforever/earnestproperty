import { load } from "cheerio";

export function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMoney(value) {
  const text = normalizeWhitespace(value).replace(/,/g, "");
  if (!text || text === "--") return null;
  const match = text.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  if (text.includes("萬")) return Math.round(amount * 10_000);
  return Math.round(amount);
}

export function parseArea(value) {
  const text = normalizeWhitespace(value).replace(/,/g, "");
  const match = text.match(/(\d+)/);
  if (!match) return null;
  return Number(match[1]);
}

function extractLegacyDetailId(url) {
  const match = String(url).match(/property-detail\/(\d+)\.html/i);
  return match?.[1] ?? null;
}

function extractTitleParts($) {
  const rawTitle = normalizeWhitespace($("title").first().text());
  const withoutBrand = rawTitle.replace(/\s*-\s*(晉誠地產|Earnest Property Agency)\s*$/i, "");
  const parts = withoutBrand.split(",").map(normalizeWhitespace).filter(Boolean);
  const titleZh = parts[0] ?? "";
  const districtZh = parts[1] ?? "";
  const numberFromTitle = parts.join(",").match(/#([A-Z0-9-]+)/i)?.[1] ?? null;
  return { titleZh, districtZh, numberFromTitle };
}

function metaContent($, selector) {
  return normalizeWhitespace($(selector).attr("content"));
}

function tableValue($, label) {
  let found = null;
  $("td").each((_, element) => {
    if (found !== null) return;
    const cell = $(element);
    if (normalizeWhitespace(cell.text()) === label) {
      found = normalizeWhitespace(cell.next("td").text());
    }
  });
  return found;
}

function parseFeatures(value) {
  return normalizeWhitespace(value)
    .split(/[,，、]/)
    .map(normalizeWhitespace)
    .filter(Boolean);
}

function extractWhatsappPhone($) {
  const href = $("a[href*='whatsapp.com/send']").first().attr("href") ?? "";
  const phone = href.match(/[?&]phone=(\d+)/)?.[1];
  return phone ?? null;
}

function extractImages($) {
  const urls = [];
  $("img[src]").each((_, element) => {
    const src = $(element).attr("src");
    if (!src) return;
    if (/imgs\.property\.hk|midPhotos|bigPhotos/i.test(src)) {
      urls.push(src.startsWith("//") ? `https:${src}` : src);
    }
  });
  return [...new Set(urls)];
}

export function parseLegacyDetail(html, url) {
  const $ = load(html);
  const { titleZh, districtZh, numberFromTitle } = extractTitleParts($);
  const metaDescription =
    metaContent($, "meta[name='description']") || metaContent($, "meta[property='og:description']");

  const legacyPropertyNo =
    $("body")
      .text()
      .match(/物業編號\s*:\s*([A-Z0-9-]+)/i)?.[1] ?? numberFromTitle;

  const saleText = tableValue($, "售價") ?? metaDescription.match(/售\$?[^,\s]+/)?.[0] ?? "";
  const rentText = tableValue($, "出租價") ?? metaDescription.match(/租\$?[^,\s]+/)?.[0] ?? "";
  const price = parseMoney(saleText);
  const rent = parseMoney(rentText);

  return {
    legacyDetailId: extractLegacyDetailId(url),
    legacyUrl: url,
    legacyPropertyNo,
    titleZh,
    districtZh,
    dealType: price ? "sale" : "rent",
    price,
    rent,
    saleableArea: parseArea(tableValue($, "實用面積") ?? metaDescription.match(/實用\d+呎/)?.[0]),
    grossArea: parseArea(tableValue($, "建築面積")),
    orientation: normalizeWhitespace(tableValue($, "座向")),
    features: parseFeatures(tableValue($, "間隔")),
    description: metaDescription,
    images: extractImages($),
    whatsappPhone: extractWhatsappPhone($),
    sourceLanguage: url.includes("/eng/") ? "en" : "tc",
  };
}
