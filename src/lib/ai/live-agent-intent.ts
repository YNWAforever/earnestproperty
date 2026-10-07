import { estateRegistry } from "../../content/estate-registry.ts";

export type LiveAgentDeal = "sale" | "rent";

/**
 * What a visitor's message is asking about. Deliberately absent: any price, budget, area or
 * date field. A visitor's number never becomes a fact.
 */
export type LiveAgentIntent = {
  /** NFKC-normalised, trimmed, latin lower-cased; never echoed to the visitor. */
  text: string;
  handoffRequested: boolean;
  valuation: boolean;
  listingNo: string | null;
  /** Registry alias hits, in registry order; NOT yet gated by publication. */
  estateSlugs: string[];
  districtSlug: string | null;
  bedrooms: number | null;
  deal: LiveAgentDeal | null;
  listingQuestion: boolean;
  estateBrowse: boolean;
};

const MAX_INPUT_CHARS = 2000;

const HANDOFF_RE = /真人|人工|代理|經紀|職員|聯絡|電話|电话|whatsapp|call|agent|human/;
const VALUATION_RE = /估價|估值|值幾錢|放盤|賣樓|業主|valuation|sell my/;
const LISTING_NO_RE = /(?<![A-Za-z0-9])([A-Za-z]{1,4}-?\d{3,10})(?![A-Za-z0-9])/;
const LISTING_QUESTION_RE =
  /盤|房|租|買|售|幾錢|多少钱|價|价|呎|實用|面積|available|price|how much|bed|flat/;
const ESTATE_BROWSE_RE = /屋苑|問屋苑|estate/;
const RENT_RE = /租|rent|lease/;
const SALE_RE = /買|售|buy|for sale/;

const DISTRICTS: Array<[string, string]> = [
  ["深井", "sham-tseng"],
  ["青龍頭", "tsing-lung-tau"],
  ["汀九", "ting-kau"],
  ["荃灣", "tsuen-wan"],
];

const CN_DIGITS: Record<string, number> = {
  一: 1,
  兩: 2,
  两: 2,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
};

function normalise(raw: string): string {
  return raw.slice(0, MAX_INPUT_CHARS).normalize("NFKC").trim().toLowerCase();
}

function parseBedrooms(text: string): number | null {
  if (/開放式|studio/.test(text)) return 0;
  const match = /([一兩两二三四五]|\d)\s*(?:房|-?\s*bed)/.exec(text);
  if (!match) return null;
  const token = match[1];
  const count = token in CN_DIGITS ? CN_DIGITS[token] : Number(token);
  if (!Number.isFinite(count) || count < 1) return null;
  return Math.min(count, 4);
}

function parseDeal(text: string): LiveAgentDeal | null {
  const rent = RENT_RE.test(text);
  const sale = SALE_RE.test(text);
  if (rent === sale) return null;
  return rent ? "rent" : "sale";
}

export function parseLiveAgentIntent(raw: string): LiveAgentIntent {
  const text = normalise(raw);
  const listingMatch = LISTING_NO_RE.exec(text);
  const estateSlugs = estateRegistry
    .filter((entry) =>
      entry.aliases.some(
        (alias) => alias.length >= 2 && text.includes(alias.normalize("NFKC").toLowerCase()),
      ),
    )
    .map((entry) => entry.slug);
  const district = DISTRICTS.find(([name]) => text.includes(name));
  return {
    text,
    handoffRequested: HANDOFF_RE.test(text),
    valuation: VALUATION_RE.test(text),
    listingNo: listingMatch ? listingMatch[1].toUpperCase() : null,
    estateSlugs,
    districtSlug: district ? district[1] : null,
    bedrooms: parseBedrooms(text),
    deal: parseDeal(text),
    listingQuestion: LISTING_QUESTION_RE.test(text),
    estateBrowse: ESTATE_BROWSE_RE.test(text),
  };
}

/** Slugs whose registry alias, name_zh or name_en (case-insensitive, length >= 2) occurs in text,
 *  restricted to the supplied published list. */
export function matchPublishedEstates(
  text: string,
  aliasSlugs: string[],
  published: Array<{ slug: string; name_zh: string; name_en: string | null }>,
): string[] {
  const haystack = text.normalize("NFKC").toLowerCase();
  return published
    .filter((estate) => {
      if (aliasSlugs.includes(estate.slug)) return true;
      return [estate.name_zh, estate.name_en].some((name) => {
        const needle = name?.normalize("NFKC").trim().toLowerCase();
        return !!needle && needle.length >= 2 && haystack.includes(needle);
      });
    })
    .map((estate) => estate.slug);
}

export const FAQ_MATCH_MIN_SHARED = 2;
export const FAQ_MATCH_MIN_RATIO = 0.5;

function grams(value: string): Set<string> {
  const normalised = value.normalize("NFKC").toLowerCase();
  const out = new Set<string>();
  for (const run of normalised.match(/[\u3400-\u4dbf\u4e00-\u9fff]+/g) ?? []) {
    const chars = Array.from(run);
    for (let i = 0; i + 1 < chars.length; i += 1) out.add(chars[i] + chars[i + 1]);
  }
  for (const word of normalised.match(/[a-z]{2,}/g) ?? []) out.add(word);
  return out;
}

/** CJK character bigrams + latin words (length >= 2) of each side. ratio = shared / bigrams(question). */
export function faqMatchScore(text: string, question: string): { shared: number; ratio: number } {
  const questionGrams = grams(question);
  if (questionGrams.size === 0) return { shared: 0, ratio: 0 };
  const textGrams = grams(text);
  let shared = 0;
  for (const gram of questionGrams) if (textGrams.has(gram)) shared += 1;
  return { shared, ratio: shared / questionGrams.size };
}
