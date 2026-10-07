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
  /** 放盤 with no valuation word: the visitor wants to list a flat, so an agent follows up. */
  sellIntent: boolean;
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

// Latin keywords are matched on word boundaries ("please" must not read as "lease");
// Chinese keywords are unanchored. Simplified forms sit beside each Traditional keyword.
const L = "(?<![a-z])";
const R = "(?![a-z])";
const HANDOFF_RE = new RegExp(
  `真人|人工|代理|經紀|经纪|職員|职员|聯絡|联络|電話|电话|${L}(?:whatsapp|calls?|calling|agents?|human)${R}`,
);
const VALUATION_RE = new RegExp(
  `估價|估价|估值|值幾錢|值几钱|賣樓|卖楼|業主|业主|${L}(?:valuation|sell my)${R}`,
);
// 放盤 alone means "I want to list my flat" (a sell-intent handoff); with any 估 word
// (估價, 估值, 估下) or 值幾錢 it is a valuation request.
const SELL_LISTING_RE = /放盤|放盘/;
const SELL_VALUATION_WORD_RE = /估|值幾錢|值几钱/;
// Only the site's public listing number shapes: EP with 3-8 digits (EP001, EP-1201, EP11001) or
// one letter with exactly 6 digits (A000001, C123456). A budget, room or unit token
// ("hkd8000000", "rm1203", "unit b1203", "flat12a") or a contact prefix ("tel912345678",
// "wa-1234567") never has that shape. Input is already lower-cased.
const LISTING_NO_RE = /(?<![a-z0-9])(ep-?\d{3,8}|[a-z]\d{6})(?![a-z0-9])/;
// A Hong Kong phone number (8 digits starting 2/3/5/6/7/8/9, optionally +852) is never a
// listing number, whatever short letter prefix ("tel", "wa", "ph") is glued to it.
const HK_PHONE_RE = /(?<!\d)(?:\+?852[\s-]*)?[235-9](?:[\s-]?\d){7}(?!\d)/g;
const LISTING_QUESTION_RE = new RegExp(
  `盤|盘|房|租|買|买|售|幾錢|几钱|多少錢|多少钱|價|价|呎|實用|实用|面積|面积|${L}(?:available|price|how much|beds?|bedrooms?|flats?)${R}`,
);
const ESTATE_BROWSE_RE = new RegExp(`屋苑|問屋苑|问屋苑|${L}estates?${R}`);
const RENT_RE = new RegExp(`租|${L}(?:rent|rents|rental|rentals|renting|lease|leasing)${R}`);
const SALE_RE = new RegExp(`買|买|售|${L}(?:buy|buying|for sale)${R}`);

const DISTRICTS: Array<[string, string]> = [
  ["深井", "sham-tseng"],
  ["青龍頭", "tsing-lung-tau"],
  ["青龙头", "tsing-lung-tau"],
  ["汀九", "ting-kau"],
  ["荃灣", "tsuen-wan"],
  ["荃湾", "tsuen-wan"],
];

// Traditional -> Simplified for the characters that occur in registry estate aliases.
const T2S: Record<string, string> = {
  島: "岛",
  麗: "丽",
  韻: "韵",
  軒: "轩",
  華: "华",
  臺: "台",
  縉: "缙",
  龍: "龙",
  騰: "腾",
  閣: "阁",
  滿: "满",
  黃: "黄",
  愛: "爱",
  灣: "湾",
  濤: "涛",
  嵐: "岚",
  漣: "涟",
  雲: "云",
};
function toSimplified(value: string): string {
  return Array.from(value, (ch) => T2S[ch] ?? ch).join("");
}

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
  if (new RegExp(`開放式|开放式|${L}studio${R}`).test(text)) return 0;
  const match =
    /([一兩两二三四五]|\d)\s*(?:間房|间房|睡房|房|-?\s*(?:bed(?:room)?s?|br)(?![a-z])|\s*rooms?(?![a-z]))/.exec(
      text,
    );
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

function findListingNo(text: string): string | null {
  const match = LISTING_NO_RE.exec(text);
  return match ? match[1].toUpperCase() : null;
}

export function parseLiveAgentIntent(raw: string): LiveAgentIntent {
  const text = normalise(raw);
  const listingNo = findListingNo(text.replace(HK_PHONE_RE, " "));
  const estateSlugs = estateRegistry
    .filter((entry) =>
      entry.aliases.some((alias) => {
        const folded = alias.normalize("NFKC").toLowerCase();
        return alias.length >= 2 && (text.includes(folded) || text.includes(toSimplified(folded)));
      }),
    )
    .map((entry) => entry.slug);
  const district = DISTRICTS.find(([name]) => text.includes(name));
  const sell = SELL_LISTING_RE.test(text);
  const valuation = VALUATION_RE.test(text) || (sell && SELL_VALUATION_WORD_RE.test(text));
  return {
    text,
    handoffRequested: HANDOFF_RE.test(text),
    valuation,
    sellIntent: sell && !valuation,
    listingNo,
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
        return (
          !!needle &&
          needle.length >= 2 &&
          (haystack.includes(needle) || haystack.includes(toSimplified(needle)))
        );
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
