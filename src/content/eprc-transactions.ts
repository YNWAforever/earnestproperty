import { estateRegistry } from "./estate-registry.ts";

// Market registration records only. This module has no agency DB/query dependency.
export const EPRC_SOURCE_LABEL = "EPRC 註冊成交";
export const EPRC_SNAPSHOT_DATE = "2026-10-27";
export const EPRC_PAGE_LIMIT = 8;

const estateQueries = [
  "帝華軒",
  "浪翠園",
  "海雲軒",
  "麗都花園",
  "碧堤半島",
  "縉皇居",
  "海韻花園",
  "海韻臺",
  "龍騰閣",
  "帝濤灣",
  "愛琴海岸",
  "黃金海岸",
  "滿名山",
  "黃金海灣",
  "帝御",
  "星堤",
  "上源",
  "Oma Oma",
  "The Carmel",
  "漣山",
  "浪濤灣",
  "豪景花園",
] as const;

const csvHeader =
  "EstateQuery,Usage,Building Name,Ins. Date,Floor,Unit,Area G,Area N,Eff. Ratio,Price $M,$/ft2 G,$/ft2 N,Nature,D.Date";

export type EprcTransaction = {
  source: "eprc";
  estateSlug: string;
  estateQuery: string;
  usage: string | null;
  building: string | null;
  instrumentDate: string | null;
  floor: string | null;
  unit: string | null;
  grossArea: number | null;
  saleableArea: number | null;
  efficiencyRatio: string | null;
  priceMillions: number | null;
  grossPsf: number | null;
  saleablePsf: number | null;
  nature: string | null;
  deliveryDate: string | null;
};

export type EprcSnapshot = {
  byEstate: Record<string, readonly EprcTransaction[]>;
  unmappedEstateQueries: string[];
};

export type EprcEstateTransactions = {
  rows: readonly EprcTransaction[];
  total: number;
};

const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
const blank = (value: string): string | null =>
  value.trim() === "-" ? null : value.trim() || null;

function numberValue(value: string): number | null {
  const text = blank(value);
  if (text === null) return null;
  if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(Number(text))) {
    throw new Error(`Invalid EPRC number: ${value}`);
  }
  return Number(text);
}

function dateValue(value: string): string | null {
  const text = blank(value);
  if (text === null) return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) throw new Error(`Invalid EPRC date: ${value}`);
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    throw new Error(`Invalid EPRC date: ${value}`);
  }
  return iso;
}

/** Parse the versioned, unquoted 14-column EPRC export; reject schema drift. */
export function buildEprcSnapshot(csv: string): EprcSnapshot {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  if (header !== csvHeader) throw new Error("Unexpected EPRC CSV header");
  const byEstate: Record<string, EprcTransaction[]> = Object.create(null);
  const unmapped = new Set<string>();
  const resolveEstate = (query: string) =>
    estateRegistry.find((entry) =>
      [entry.nameZh, entry.nameEn, ...entry.aliases].some(
        (name) => typeof name === "string" && normalize(name) === normalize(query),
      ),
    );
  for (const query of estateQueries) {
    const entry = resolveEstate(query);
    if (entry) byEstate[entry.slug] = [];
    else unmapped.add(query);
  }
  for (const line of lines.filter((line) => line.trim())) {
    const fields = line.split(",");
    if (fields.length !== 14 || line.includes('"')) throw new Error("Unexpected EPRC CSV columns");
    const [
      query,
      usage,
      building,
      instrumentDate,
      floor,
      unit,
      grossArea,
      saleableArea,
      efficiencyRatio,
      priceMillions,
      grossPsf,
      saleablePsf,
      nature,
      deliveryDate,
    ] = fields;
    const entry = resolveEstate(query);
    if (!entry || !Object.hasOwn(byEstate, entry.slug)) {
      unmapped.add(query.trim());
      continue;
    }
    byEstate[entry.slug].push({
      source: "eprc",
      estateSlug: entry.slug,
      estateQuery: query.trim(),
      usage: blank(usage),
      building: blank(building),
      instrumentDate: dateValue(instrumentDate),
      floor: blank(floor),
      unit: blank(unit),
      grossArea: numberValue(grossArea),
      saleableArea: numberValue(saleableArea),
      efficiencyRatio: blank(efficiencyRatio),
      priceMillions: numberValue(priceMillions),
      grossPsf: numberValue(grossPsf),
      saleablePsf: numberValue(saleablePsf),
      nature: blank(nature),
      deliveryDate: dateValue(deliveryDate),
    });
  }
  for (const rows of Object.values(byEstate)) {
    rows.sort((a, b) => (b.instrumentDate ?? "").localeCompare(a.instrumentDate ?? ""));
  }
  return { byEstate, unmappedEstateQueries: [...unmapped].sort() };
}

export function getEprcEstateTransactions(
  snapshot: EprcSnapshot,
  slug: string,
): EprcEstateTransactions | null {
  if (!Object.hasOwn(snapshot.byEstate, slug)) return null;
  const rows = snapshot.byEstate[slug];
  return { rows: rows.slice(0, EPRC_PAGE_LIMIT), total: rows.length };
}
