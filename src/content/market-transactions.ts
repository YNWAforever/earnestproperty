import { estateRegistry } from "./estate-registry.ts";

/**
 * Market-registration snapshot reader (docs/market-transactions/data-contract.md,
 * schemaVersion 1). Pure data: no agency DB/query dependency, no network, no DOM.
 *
 * Every value the snapshot stores is a *source row* from the public old-site list
 * for the 2021–2026 year filters. A row count is never a deal count: the module
 * exposes `rowCount` (來源紀錄) and, when 臨時合約 / 買賣合約 rows pair up,
 * `dedupedDealCount` (宗) as two separate numbers.
 */
export const MARKET_PAGE_SIZE = 20;

const MARKET_DETAIL_URL = "https://www.earnestproperty.com.hk/tran_prop_detail.php";
const YEAR_FILTER_MIN = 2021;
const YEAR_FILTER_MAX = 2026;
const NATURE_PROVISIONAL = "臨時合約";
const NATURE_FORMAL = "買賣合約";
const UNIT_SEPARATOR = "\u0000";
const GROUP_SEPARATOR = "\u0001";

export type MarketSourcePackage = "estates-61" | "mount";
export type MarketEstateStatus = "covered" | "filtered-empty";
/** Only recorded when the published 呎價 label states the basis. */
export type MarketPsfBasis = "建築" | "實用";

export type MarketTransactionRow = {
  ref: string;
  yearFilter: number;
  registrationDate: string;
  instrumentDate: string;
  registrationNo: string | null;
  nature: string;
  phase: string | null;
  tower: string | null;
  houseId: string | null;
  floor: string | null;
  unit: string | null;
  address: string | null;
  district: string | null;
  considerationMillion: number | null;
  grossAreaSqft: number | null;
  pricePerSqft: number | null;
  psfBasis: MarketPsfBasis | null;
  completionYear: number | null;
};

export type MarketEstateRecord = {
  slug: string;
  nameZh: string;
  sourcePackage: MarketSourcePackage;
  asOf: string;
  registrationThrough: string | null;
  rowCount: number;
  status: MarketEstateStatus;
  note: string | null;
  listSourceUrl: string | null;
};

/**
 * Estate record plus the pairing audit. `rowCount` counts source rows;
 * `dedupedDealCount` is the paired-deal count and must never be shown as the
 * same unlabelled number.
 */
export type MarketEstateSummary = MarketEstateRecord & {
  pairedRowCount: number;
  dedupedDealCount: number;
  mixedSameUnitCount: number;
};

export type MarketChartMonth = {
  slug: string;
  month: string;
  count: number;
  avgPsf: number | null;
  sourceDisplayedPpsf: string | null;
  visualVerified: boolean;
  chartTitle: string | null;
  periodStart: string | null;
  periodEnd: string | null;
};

export type MarketPackageStamp = { package: string; asOf: string };

export type MarketSnapshotCounts = {
  sourceRows: number;
  estates61Rows: number;
  mountRows: number;
  estates: number;
  estatesWithRows: number;
  filteredEmpty: number;
  chartMonths: number;
  chartEstates: number;
};

export type MarketSnapshot = {
  schemaVersion: 1;
  generatedFrom: { estates61: MarketPackageStamp; mount: MarketPackageStamp };
  registrationThrough: string;
  counts: MarketSnapshotCounts;
  estates: MarketEstateSummary[];
  rowsByEstate: Record<string, MarketTransactionRow[]>;
  chartTranscription: MarketChartMonth[];
};

export type MarketTransactionFilters = {
  year?: number | null;
  nature?: string | null;
  phase?: string | null;
  page?: number;
};

export type MarketFacet = { value: string | number; count: number };
/** Year facets always carry the numeric year filter, never a stringified one. */
export type MarketYearFacet = { value: number; count: number };

export type MarketEstateTransactions = {
  estate: MarketEstateSummary;
  rows: MarketTransactionRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  facets: { years: MarketYearFacet[]; natures: MarketFacet[]; phases: MarketFacet[] };
  activeFilters: MarketTransactionFilters;
};

/* ------------------------------------------------------------------ *
 * Validation — throws on schema drift, never coerces
 * ------------------------------------------------------------------ */
type JsonObject = Record<string, unknown>;

const registrySlugs = new Set(estateRegistry.map((entry) => entry.slug));

function invalid(path: string, message: string): never {
  throw new Error(`Invalid market snapshot at ${path}: ${message}`);
}

function readObject(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "expected an object");
  }
  return value as JsonObject;
}

function readArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path, "expected an array");
  return value;
}

function readString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "")
    invalid(path, "expected a non-empty string");
  return value;
}

function readNullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") invalid(path, "expected a string or null");
  return value;
}

function readNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    invalid(path, "expected a finite number");
  return value;
}

function readNullableNumber(value: unknown, path: string): number | null {
  if (value === null) return null;
  return readNumber(value, path);
}

function readPositiveNumber(value: unknown, path: string): number {
  const number = readNumber(value, path);
  if (number <= 0) invalid(path, `expected a positive number, got ${number}`);
  return number;
}

function readNullablePositiveNumber(value: unknown, path: string): number | null {
  if (value === null) return null;
  return readPositiveNumber(value, path);
}

function readInteger(value: unknown, path: string, min: number, max: number): number {
  const number = readNumber(value, path);
  if (!Number.isInteger(number)) invalid(path, `expected an integer, got ${number}`);
  if (number < min || number > max) invalid(path, `expected ${min}-${max}, got ${number}`);
  return number;
}

function readNonNegativeInteger(value: unknown, path: string): number {
  return readInteger(value, path, 0, Number.MAX_SAFE_INTEGER);
}

function readNullableInteger(value: unknown, path: string): number | null {
  if (value === null) return null;
  const number = readNumber(value, path);
  if (!Number.isInteger(number)) invalid(path, `expected an integer or null, got ${number}`);
  return number;
}

function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "expected a boolean");
  return value;
}

/** ISO calendar date. Registration and instrument dates are separate fields. */
function readIsoDate(value: unknown, path: string): string {
  const text = readString(value, path);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) invalid(path, `not an ISO date: ${JSON.stringify(text)}`);
  const date = new Date(`${text}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    invalid(path, `not a real calendar date: ${JSON.stringify(text)}`);
  }
  return text;
}

function readNullableIsoDate(value: unknown, path: string): string | null {
  if (value === null) return null;
  return readIsoDate(value, path);
}

/** ISO timestamp with an explicit offset, e.g. 2026-11-23T01:58:00+08:00. */
function readTimestamp(value: unknown, path: string): string {
  const text = readString(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    invalid(path, `not an ISO timestamp with offset: ${JSON.stringify(text)}`);
  }
  if (!Number.isFinite(new Date(text).getTime())) invalid(path, `not a real timestamp: ${text}`);
  return text;
}

function readYearMonth(value: unknown, path: string): string {
  const text = readString(value, path);
  const match = /^(\d{4})-(\d{2})$/.exec(text);
  if (match === null || Number(match[2]) < 1 || Number(match[2]) > 12) {
    invalid(path, `not a YYYY-MM month: ${JSON.stringify(text)}`);
  }
  return text;
}

function readNullableYearMonth(value: unknown, path: string): string | null {
  if (value === null) return null;
  return readYearMonth(value, path);
}

function readEnum<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  const text = readString(value, path);
  const match = allowed.find((entry) => entry === text);
  if (match === undefined)
    invalid(path, `expected one of ${allowed.join(", ")}, got ${JSON.stringify(text)}`);
  return match;
}

function readRegistrySlug(value: unknown, path: string): string {
  const slug = readString(value, path);
  if (!registrySlugs.has(slug))
    invalid(path, `slug ${JSON.stringify(slug)} is not in estate-registry.ts`);
  return slug;
}

/* ------------------------------------------------------------------ *
 * Readers — rebuild every structure in contract key order
 * ------------------------------------------------------------------ */
function readTransactionRow(value: unknown, path: string): MarketTransactionRow {
  const row = readObject(value, path);
  const pricePerSqft = readNullablePositiveNumber(row.pricePerSqft, `${path}.pricePerSqft`);
  return {
    ref: readString(row.ref, `${path}.ref`),
    yearFilter: readInteger(row.yearFilter, `${path}.yearFilter`, YEAR_FILTER_MIN, YEAR_FILTER_MAX),
    registrationDate: readIsoDate(row.registrationDate, `${path}.registrationDate`),
    // Instrument dates legitimately fall outside the 2021–2026 list filter
    // (65 rows in the 61 package; one as early as 2002-06-28) and must be kept.
    instrumentDate: readIsoDate(row.instrumentDate, `${path}.instrumentDate`),
    registrationNo: readNullableString(row.registrationNo, `${path}.registrationNo`),
    nature: readString(row.nature, `${path}.nature`),
    phase: readNullableString(row.phase, `${path}.phase`),
    tower: readNullableString(row.tower, `${path}.tower`),
    houseId: readNullableString(row.houseId, `${path}.houseId`),
    floor: readNullableString(row.floor, `${path}.floor`),
    unit: readNullableString(row.unit, `${path}.unit`),
    address: readNullableString(row.address, `${path}.address`),
    district: readNullableString(row.district, `${path}.district`),
    considerationMillion: readNullablePositiveNumber(
      row.considerationMillion,
      `${path}.considerationMillion`,
    ),
    grossAreaSqft: readNullablePositiveNumber(row.grossAreaSqft, `${path}.grossAreaSqft`),
    pricePerSqft,
    psfBasis:
      row.psfBasis === null
        ? null
        : readEnum(row.psfBasis, `${path}.psfBasis`, ["建築", "實用"] as const),
    completionYear: readNullableInteger(row.completionYear, `${path}.completionYear`),
  };
}

function readEstateRecord(value: unknown, path: string): MarketEstateRecord {
  const estate = readObject(value, path);
  const slug = readRegistrySlug(estate.slug, `${path}.slug`);
  const status = readEnum(estate.status, `${path}.status`, [
    "covered",
    "filtered-empty",
  ] as const satisfies readonly MarketEstateStatus[]);
  const note = readNullableString(estate.note, `${path}.note`);
  if (status === "filtered-empty" && note === null) {
    invalid(`${path}.note`, "a filtered-empty estate needs its short zh-HK note");
  }
  return {
    slug,
    nameZh: readString(estate.nameZh, `${path}.nameZh`),
    sourcePackage: readEnum(estate.sourcePackage, `${path}.sourcePackage`, [
      "estates-61",
      "mount",
    ] as const satisfies readonly MarketSourcePackage[]),
    asOf: readTimestamp(estate.asOf, `${path}.asOf`),
    registrationThrough: readNullableIsoDate(
      estate.registrationThrough,
      `${path}.registrationThrough`,
    ),
    rowCount: readNonNegativeInteger(estate.rowCount, `${path}.rowCount`),
    status,
    note,
    listSourceUrl:
      estate.listSourceUrl === null
        ? null
        : readString(estate.listSourceUrl, `${path}.listSourceUrl`),
  };
}

function readChartMonth(value: unknown, path: string): MarketChartMonth {
  const month = readObject(value, path);
  const count = readNonNegativeInteger(month.count, `${path}.count`);
  const avgPsf = readNullableNumber(month.avgPsf, `${path}.avgPsf`);
  // Zero-volume months must not carry a normalized average, even when the chart
  // printed a repeated label on a connecting line.
  if (count === 0 && avgPsf !== null) {
    invalid(`${path}.avgPsf`, `must be null when count is 0, got ${avgPsf}`);
  }
  if (avgPsf !== null && avgPsf <= 0)
    invalid(`${path}.avgPsf`, "expected a positive average or null");
  return {
    slug: readRegistrySlug(month.slug, `${path}.slug`),
    month: readYearMonth(month.month, `${path}.month`),
    count,
    avgPsf,
    sourceDisplayedPpsf: readNullableString(
      month.sourceDisplayedPpsf,
      `${path}.sourceDisplayedPpsf`,
    ),
    visualVerified: readBoolean(month.visualVerified, `${path}.visualVerified`),
    chartTitle: readNullableString(month.chartTitle, `${path}.chartTitle`),
    periodStart: readNullableYearMonth(month.periodStart, `${path}.periodStart`),
    periodEnd: readNullableYearMonth(month.periodEnd, `${path}.periodEnd`),
  };
}

function readPackageStamp(value: unknown, path: string): MarketPackageStamp {
  const stamp = readObject(value, path);
  return {
    package: readString(stamp.package, `${path}.package`),
    asOf: readTimestamp(stamp.asOf, `${path}.asOf`),
  };
}

function readCounts(value: unknown, path: string): MarketSnapshotCounts {
  const counts = readObject(value, path);
  return {
    sourceRows: readNonNegativeInteger(counts.sourceRows, `${path}.sourceRows`),
    estates61Rows: readNonNegativeInteger(counts.estates61Rows, `${path}.estates61Rows`),
    mountRows: readNonNegativeInteger(counts.mountRows, `${path}.mountRows`),
    estates: readNonNegativeInteger(counts.estates, `${path}.estates`),
    estatesWithRows: readNonNegativeInteger(counts.estatesWithRows, `${path}.estatesWithRows`),
    filteredEmpty: readNonNegativeInteger(counts.filteredEmpty, `${path}.filteredEmpty`),
    chartMonths: readNonNegativeInteger(counts.chartMonths, `${path}.chartMonths`),
    chartEstates: readNonNegativeInteger(counts.chartEstates, `${path}.chartEstates`),
  };
}

/* ------------------------------------------------------------------ *
 * Ordering and row identity
 * ------------------------------------------------------------------ */
function compareRows(left: MarketTransactionRow, right: MarketTransactionRow): number {
  if (left.registrationDate !== right.registrationDate) {
    return left.registrationDate < right.registrationDate ? 1 : -1;
  }
  if (left.instrumentDate !== right.instrumentDate) {
    return left.instrumentDate < right.instrumentDate ? 1 : -1;
  }
  if (left.ref !== right.ref) return left.ref < right.ref ? -1 : 1;
  return 0;
}

function rowIdentityKey(packageName: MarketSourcePackage, row: MarketTransactionRow): string {
  return `${packageName}${GROUP_SEPARATOR}${row.yearFilter}${GROUP_SEPARATOR}${row.ref}`;
}

/**
 * Row identity is sourcePackage + yearFilter + ref. A second load of the same
 * package can never add a duplicate row, so a collision here is data drift.
 */
function assertUniqueRows(
  estates: MarketEstateRecord[],
  rowsByEstate: Record<string, MarketTransactionRow[]>,
) {
  const seen = new Map<string, string>();
  for (const estate of estates) {
    for (const row of rowsByEstate[estate.slug] ?? []) {
      const key = rowIdentityKey(estate.sourcePackage, row);
      const previous = seen.get(key);
      if (previous !== undefined) {
        invalid(
          `rowsByEstate.${estate.slug}`,
          `row identity collision ${JSON.stringify(key)} (also in ${previous}); ` +
            "sourcePackage + yearFilter + ref must be unique",
        );
      }
      seen.set(key, estate.slug);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Pairing (data-contract.md, "Preliminary / formal pairing rule")
 * ------------------------------------------------------------------ */
/**
 * Unit identity: the recorded address when the row has one, else
 * tower + floor + unit + house. Both source packages record an address on every
 * row, where the rule's first clause applies.
 */
function unitKey(row: MarketTransactionRow): string {
  if (row.address !== null) return `address${GROUP_SEPARATOR}${row.address}`;
  const parts = [row.tower, row.floor, row.unit, row.houseId].map((part) => part ?? "");
  return `unit${GROUP_SEPARATOR}${parts.join(UNIT_SEPARATOR)}`;
}

function considerationKey(row: MarketTransactionRow): string {
  return row.considerationMillion === null ? "null" : String(row.considerationMillion);
}

export type MarketPairingCounts = {
  pairedRowCount: number;
  dedupedDealCount: number;
  mixedSameUnitCount: number;
};

/**
 * A pair is one 臨時合約 plus one 買賣合約 with the same unit identity, the same
 * consideration and the same registration date; their instrument dates may
 * differ. Nothing is dropped: cross-date mixed candidates and same-nature
 * duplicates stay as source rows and are reported by `mixedSameUnitCount`.
 *
 * Tower tie-break (2026-11-24 audit, finding 2): the street-alias estates
 * publish addresses that omit the tower -- NAPA records 第03座 and 第05座 both
 * as `掃管笏路88號, 10樓 A室` -- so an address-only pair key merged different
 * towers. Candidate pairs are therefore matched within the same recorded tower
 * first, and a row with no recorded tower may still match any tower, because
 * that is all the published address supports.
 */
function pairingCounts(rows: MarketTransactionRow[]): MarketPairingCounts {
  const pairGroups = new Map<string, MarketTransactionRow[]>();
  const unitGroupSizes = new Map<string, number>();
  for (const row of rows) {
    const unit = unitKey(row);
    const consideration = considerationKey(row);
    const pairKey = `${unit}${GROUP_SEPARATOR}${consideration}${GROUP_SEPARATOR}${row.registrationDate}`;
    const group = pairGroups.get(pairKey);
    if (group === undefined) pairGroups.set(pairKey, [row]);
    else group.push(row);
    const unitGroupKey = `${unit}${GROUP_SEPARATOR}${consideration}`;
    unitGroupSizes.set(unitGroupKey, (unitGroupSizes.get(unitGroupKey) ?? 0) + 1);
  }
  const pairsByUnitGroup = new Map<string, number>();
  let pairs = 0;
  for (const [pairKey, group] of pairGroups) {
    const provisional = group.filter((row) => row.nature === NATURE_PROVISIONAL);
    const formal = group.filter((row) => row.nature === NATURE_FORMAL);
    const usedFormal = new Set<MarketTransactionRow>();
    let matched = 0;
    for (const provisionalRow of provisional) {
      const partner = formal.find(
        (candidate) =>
          !usedFormal.has(candidate) &&
          (provisionalRow.tower === null ||
            candidate.tower === null ||
            provisionalRow.tower === candidate.tower),
      );
      if (partner === undefined) continue;
      usedFormal.add(partner);
      matched += 1;
    }
    pairs += matched;
    // Recover the unit group from the pair key (drop the registration date).
    const unitGroupKey = pairKey.slice(0, pairKey.lastIndexOf(GROUP_SEPARATOR));
    pairsByUnitGroup.set(unitGroupKey, (pairsByUnitGroup.get(unitGroupKey) ?? 0) + matched);
  }
  let mixedSameUnitCount = 0;
  for (const [unitGroupKey, size] of unitGroupSizes) {
    if (size < 2) continue;
    const pairedRows = (pairsByUnitGroup.get(unitGroupKey) ?? 0) * 2;
    const remainder = size - pairedRows;
    if (remainder > 0) mixedSameUnitCount += remainder;
  }
  return { pairedRowCount: pairs * 2, dedupedDealCount: rows.length - pairs, mixedSameUnitCount };
}

/* ------------------------------------------------------------------ *
 * Snapshot
 * ------------------------------------------------------------------ */
/**
 * Validate a parsed snapshot document and return the reader's own structures.
 * Shape drift throws — nothing is coerced or defaulted. Two calls on the same
 * document return deeply equal snapshots (the data layer's determinism gate).
 */
export function buildMarketSnapshot(doc: unknown): MarketSnapshot {
  const root = readObject(doc, "snapshot");
  if (root.schemaVersion !== 1) {
    invalid("snapshot.schemaVersion", `expected 1, got ${JSON.stringify(root.schemaVersion)}`);
  }

  const generatedFrom = readObject(root.generatedFrom, "snapshot.generatedFrom");
  const registrationThrough = readIsoDate(root.registrationThrough, "snapshot.registrationThrough");
  const counts = readCounts(root.counts, "snapshot.counts");

  const estateValues = readArray(root.estates, "snapshot.estates");
  const estates = estateValues.map((value, index) =>
    readEstateRecord(value, `snapshot.estates[${index}]`),
  );
  const estateBySlug = new Map<string, MarketEstateRecord>();
  for (const [index, estate] of estates.entries()) {
    if (estateBySlug.has(estate.slug)) {
      invalid(`snapshot.estates[${index}].slug`, `duplicate estate ${estate.slug}`);
    }
    estateBySlug.set(estate.slug, estate);
  }

  const rowsSource = readObject(root.rowsByEstate, "snapshot.rowsByEstate");
  const rowsByEstate: Record<string, MarketTransactionRow[]> = {};
  let sourceRows = 0;
  let estates61Rows = 0;
  let mountRows = 0;
  let latestRegistrationDate: string | null = null;
  for (const slug of Object.keys(rowsSource).sort()) {
    const estate = estateBySlug.get(slug);
    if (estate === undefined)
      invalid(`snapshot.rowsByEstate.${slug}`, "no matching entry in snapshot.estates");
    const rows = readArray(rowsSource[slug], `snapshot.rowsByEstate.${slug}`).map((value, index) =>
      readTransactionRow(value, `snapshot.rowsByEstate.${slug}[${index}]`),
    );
    rows.sort(compareRows);
    rowsByEstate[slug] = rows;
    if (rows.length !== estate.rowCount) {
      invalid(
        `snapshot.rowsByEstate.${slug}`,
        `has ${rows.length} rows but snapshot.estates rowCount is ${estate.rowCount}`,
      );
    }
    const estateLatest = rows[0]?.registrationDate ?? null;
    // Rows are sorted registrationDate descending, so the head is the newest.
    for (const row of rows) {
      if (latestRegistrationDate === null || row.registrationDate > latestRegistrationDate) {
        latestRegistrationDate = row.registrationDate;
      }
    }
    if (estate.registrationThrough !== estateLatest) {
      invalid(
        `snapshot.estates.${estate.slug}.registrationThrough`,
        `expected the newest row registration date ${JSON.stringify(estateLatest)}, ` +
          `got ${JSON.stringify(estate.registrationThrough)}`,
      );
    }
    sourceRows += rows.length;
    if (estate.sourcePackage === "mount") mountRows += rows.length;
    else estates61Rows += rows.length;
  }
  assertUniqueRows(estates, rowsByEstate);
  if (latestRegistrationDate !== registrationThrough) {
    invalid(
      "snapshot.registrationThrough",
      `expected the newest registration date ${JSON.stringify(latestRegistrationDate)}, ` +
        `got ${JSON.stringify(registrationThrough)}`,
    );
  }

  const chartValues = readArray(root.chartTranscription, "snapshot.chartTranscription");
  const chartTranscription = chartValues.map((value, index) =>
    readChartMonth(value, `snapshot.chartTranscription[${index}]`),
  );
  chartTranscription.sort((left, right) => {
    if (left.slug !== right.slug) return left.slug < right.slug ? -1 : 1;
    return left.month < right.month ? -1 : left.month > right.month ? 1 : 0;
  });
  const chartKeys = new Set<string>();
  for (const month of chartTranscription) {
    const key = `${month.slug}${GROUP_SEPARATOR}${month.month}`;
    if (chartKeys.has(key)) {
      invalid("snapshot.chartTranscription", `duplicate month ${JSON.stringify(key)}`);
    }
    chartKeys.add(key);
  }

  // Counts are derivable facts: a snapshot whose own counts contradict its rows
  // is drift, not a formatting preference.
  const derivedCounts: MarketSnapshotCounts = {
    sourceRows,
    estates61Rows,
    mountRows,
    estates: estates.length,
    estatesWithRows: estates.filter((estate) => estate.rowCount > 0).length,
    filteredEmpty: estates.filter((estate) => estate.status === "filtered-empty").length,
    chartMonths: chartTranscription.length,
    chartEstates: new Set(chartTranscription.map((month) => month.slug)).size,
  };
  for (const key of Object.keys(derivedCounts) as (keyof MarketSnapshotCounts)[]) {
    if (counts[key] !== derivedCounts[key]) {
      invalid(
        `snapshot.counts.${key}`,
        `says ${counts[key]} but the snapshot contains ${derivedCounts[key]}`,
      );
    }
  }

  const summaries = estates.map((estate) => ({
    ...estate,
    ...pairingCounts(rowsByEstate[estate.slug] ?? []),
  }));

  return {
    schemaVersion: 1,
    generatedFrom: {
      estates61: readPackageStamp(generatedFrom.estates61, "snapshot.generatedFrom.estates61"),
      mount: readPackageStamp(generatedFrom.mount, "snapshot.generatedFrom.mount"),
    },
    registrationThrough,
    counts,
    estates: summaries,
    rowsByEstate,
    chartTranscription,
  };
}

/* ------------------------------------------------------------------ *
 * Filters, facets and pagination
 * ------------------------------------------------------------------ */
function filterNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) return null;
  return value;
}

function filterText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function clampPage(value: unknown, pageCount: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  const page = Math.trunc(value);
  if (page < 1) return 1;
  if (page > pageCount) return pageCount;
  return page;
}

function facetCounts<T extends string>(values: readonly T[]): MarketFacet[] {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].map(([value, count]) => ({ value, count }));
}

function compareFacet(left: MarketFacet, right: MarketFacet): number {
  if (left.count !== right.count) return right.count - left.count;
  if (typeof left.value === "number" && typeof right.value === "number") {
    return left.value - right.value;
  }
  const leftText = String(left.value);
  const rightText = String(right.value);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

/**
 * Facet counts come from the unfiltered estate rows, so a selected filter never
 * hides the other options or changes their counts.
 */
function buildFacets(rows: readonly MarketTransactionRow[]): MarketEstateTransactions["facets"] {
  const yearCounts = new Map<number, number>();
  for (const row of rows) yearCounts.set(row.yearFilter, (yearCounts.get(row.yearFilter) ?? 0) + 1);
  const years = [...yearCounts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => left.value - right.value);
  const natures = facetCounts(rows.map((row) => row.nature)).sort(compareFacet);
  const phases = facetCounts(rows.flatMap((row) => (row.phase === null ? [] : [row.phase]))).sort(
    compareFacet,
  );
  return { years, natures, phases };
}

/**
 * One estate's page of source rows. `total` is the filtered source-row count and
 * `page`/`pageCount` are always within 1..pageCount (pageCount is at least 1 so
 * a filtered-empty estate still returns a usable, honest empty page).
 */
export function getEstateMarketTransactions(
  snapshot: MarketSnapshot,
  slug: string,
  filters: MarketTransactionFilters = {},
): MarketEstateTransactions | null {
  const estate = snapshot.estates.find((entry) => entry.slug === slug);
  if (estate === undefined) return null;
  const allRows = snapshot.rowsByEstate[slug] ?? [];
  const facets = buildFacets(allRows);

  const year = filterNumber(filters.year);
  const nature = filterText(filters.nature);
  const phase = filterText(filters.phase);
  const filtered = allRows.filter(
    (row) =>
      (year === null || row.yearFilter === year) &&
      (nature === null || row.nature === nature) &&
      (phase === null || row.phase === phase),
  );

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / MARKET_PAGE_SIZE));
  const page = clampPage(filters.page, pageCount);
  const start = (page - 1) * MARKET_PAGE_SIZE;

  return {
    estate,
    rows: filtered.slice(start, start + MARKET_PAGE_SIZE),
    total,
    page,
    pageCount,
    pageSize: MARKET_PAGE_SIZE,
    facets,
    activeFilters: { year, nature, phase, page },
  };
}

/** Visually transcribed chart months for one estate, ordered by month. */
export function getEstateChartTranscription(
  snapshot: MarketSnapshot,
  slug: string,
): MarketChartMonth[] {
  return snapshot.chartTranscription.filter((month) => month.slug === slug);
}

/**
 * Old-site detail URL derived from the row's own reference and year filter; the
 * snapshot deliberately stores no per-row URL.
 */
export function marketTransactionUrl(row: MarketTransactionRow): string {
  return `${MARKET_DETAIL_URL}?ref=${encodeURIComponent(row.ref)}&year=${row.yearFilter}`;
}
