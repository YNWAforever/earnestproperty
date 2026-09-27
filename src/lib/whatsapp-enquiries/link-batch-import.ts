import type { LinkOfferSelection } from "../admin/whatsapp-link-selection.ts";
import type { BatchRowDraft } from "./link-batch-policy.ts";

export type ImportSource = BatchRowDraft["input"]["placementSource"];
export type ImportRow = {
  publicListingNo: string;
  dealType: "sale" | "rent";
  source: ImportSource;
  placementInput: string;
  staffReference?: string;
  line?: number;
};
export type ImportError = {
  row: number;
  column: string;
  errorCode: string;
  value?: string;
};
export type ImportResult = { rows: ImportRow[]; errors: ImportError[] };
export type DraftExpansion = {
  rows: BatchRowDraft[];
  errors: ImportError[];
  offerCount: number;
  rowCount: number;
};
export type ImportReference = {
  id: string;
  namespace: string;
  externalReference: string;
  staffId: string;
  valid: boolean;
};
const SOURCES: ImportSource[] = ["website", "28hse", "youtube", "other"];
const HEADERS = [
  "public_listing_no",
  "deal_type",
  "source",
  "placement_url_or_id",
  "staff_reference",
];
const clean = (value: string) => value.replace(/^\uFEFF/, "").trim();
const urlLike = (value: string) => /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)/i.test(value);
const fail = (errorCode: string): { errorCode: string } => ({ errorCode });

export function parsePlacementInput(
  source: ImportSource,
  value: string,
): { placementId: string } | { errorCode: string } {
  const input = clean(value);
  if (source === "website") {
    return !input || input === "website:primary"
      ? { placementId: "website:primary" }
      : fail("WEBSITE_PLACEMENT_INVALID");
  }
  if (!input) return fail("PLACEMENT_REQUIRED");
  if (urlLike(input)) {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      return fail("UNRECOGNIZED_URL");
    }
    if (url.protocol !== "https:") return fail("UNRECOGNIZED_URL");
    if (source === "28hse") {
      if (url.hostname !== "www.28hse.com") return fail("SOURCE_URL_MISMATCH");
      const match = url.pathname.match(/^\/(?:buy|rent)\/[^/]+\/property-(\d+)\/?$/i);
      return match ? { placementId: match[1] } : fail("UNRECOGNIZED_URL");
    }
    if (source === "youtube") {
      if (!["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname))
        return fail("SOURCE_URL_MISMATCH");
      const id =
        url.hostname === "youtu.be"
          ? url.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/)?.[1]
          : url.pathname === "/watch"
            ? url.searchParams.get("v")
            : url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? { placementId: id } : fail("UNRECOGNIZED_URL");
    }
    return fail("UNRECOGNIZED_URL");
  }
  if (/^https?:/i.test(input) || input.includes("/") || input.includes("?"))
    return fail("UNRECOGNIZED_URL");
  if (!/^[A-Za-z0-9:_-]{1,160}$/.test(input)) return fail("PLACEMENT_ID_INVALID");
  if (source === "youtube" && !/^[A-Za-z0-9_-]{11}$/.test(input))
    return fail("PLACEMENT_ID_INVALID");
  return { placementId: input };
}

function urlDealType(value: string): "sale" | "rent" | null {
  try {
    const url = new URL(value);
    if (url.hostname !== "www.28hse.com") return null;
    if (url.pathname.startsWith("/buy/")) return "sale";
    if (url.pathname.startsWith("/rent/")) return "rent";
  } catch {
    // A direct placement ID has no source deal type.
  }
  return null;
}

function splitDelimited(
  text: string,
  delimiter: string,
): {
  records: { cells: string[]; line: number }[];
  errors: ImportError[];
} {
  const records: { cells: string[]; line: number }[] = [];
  const errors: ImportError[] = [];
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let rowStart = 1;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '"') {
      if (quoted && normalized[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted || !field) quoted = !quoted;
      else errors.push({ row: rowStart, column: "row", errorCode: "CSV_QUOTE_INVALID" });
    } else if (ch === delimiter && !quoted) {
      cells.push(field);
      field = "";
    } else if (ch === "\n") {
      if (quoted) field += "\n";
      else {
        cells.push(field);
        if (cells.some((cell) => cell.length)) records.push({ cells, line: rowStart });
        cells = [];
        field = "";
        rowStart = line + 1;
      }
      line++;
    } else field += ch;
  }
  if (quoted) errors.push({ row: rowStart, column: "row", errorCode: "CSV_QUOTE_UNCLOSED" });
  cells.push(field);
  if (cells.some((cell) => cell.length)) records.push({ cells, line: rowStart });
  return { records, errors };
}

export function parseBatchImport(text: string, format: "csv" | "tsv"): ImportResult {
  const { records, errors } = splitDelimited(text, format === "csv" ? "," : "\t");
  if (
    !records.length ||
    HEADERS.some((header, index) => clean(records[0].cells[index] ?? "") !== header) ||
    records[0].cells.length !== HEADERS.length
  ) {
    return {
      rows: [],
      errors: [...errors, { row: 1, column: "header", errorCode: "HEADER_INVALID" }],
    };
  }
  const rows: ImportRow[] = [];
  const seen = new Map<string, number>();
  for (const record of records.slice(1)) {
    const [rawNo, rawDeal, rawSource, rawPlacement, rawStaff] = record.cells;
    if (record.cells.length !== HEADERS.length) {
      errors.push({ row: record.line, column: "row", errorCode: "COLUMN_COUNT_INVALID" });
      continue;
    }
    const publicListingNo = clean(rawNo).toUpperCase();
    const dealType = clean(rawDeal);
    const source = clean(rawSource);
    const placementInput = clean(rawPlacement);
    const staffReference = clean(rawStaff);
    let invalid = false;
    if (!publicListingNo || publicListingNo.length > 160) {
      errors.push({
        row: record.line,
        column: "public_listing_no",
        errorCode: "LISTING_NO_INVALID",
        value: rawNo,
      });
      invalid = true;
    }
    if (dealType !== "sale" && dealType !== "rent") {
      errors.push({
        row: record.line,
        column: "deal_type",
        errorCode: "DEAL_TYPE_INVALID",
        value: rawDeal,
      });
      invalid = true;
    }
    if (!SOURCES.includes(source as ImportSource)) {
      errors.push({
        row: record.line,
        column: "source",
        errorCode: "SOURCE_INVALID",
        value: rawSource,
      });
      invalid = true;
    }
    if (invalid) continue;
    const typedSource = source as ImportSource;
    const parsed = parsePlacementInput(typedSource, placementInput);
    if ("errorCode" in parsed) {
      errors.push({
        row: record.line,
        column: "placement_url_or_id",
        errorCode: parsed.errorCode,
        value: rawPlacement,
      });
      continue;
    }
    if (
      typedSource === "28hse" &&
      urlDealType(placementInput) !== null &&
      urlDealType(placementInput) !== dealType
    ) {
      errors.push({
        row: record.line,
        column: "deal_type",
        errorCode: "DEAL_TYPE_MISMATCH",
        value: rawDeal,
      });
      continue;
    }
    const row: ImportRow = {
      publicListingNo,
      dealType: dealType as "sale" | "rent",
      source: typedSource,
      placementInput,
      ...(staffReference ? { staffReference } : {}),
      line: record.line,
    };
    const identity = JSON.stringify([
      publicListingNo,
      dealType,
      source,
      parsed.placementId,
      staffReference,
    ]);
    const prior = seen.get(identity);
    if (prior)
      errors.push({
        row: record.line,
        column: "row",
        errorCode: "DUPLICATE_ROW",
        value: String(prior),
      });
    else seen.set(identity, record.line);
    rows.push(row);
  }
  if (rows.length > 1000) errors.push({ row: 0, column: "row", errorCode: "BATCH_LIMIT" });
  return { rows, errors };
}

function batchRow(
  offer: LinkOfferSelection,
  source: ImportSource,
  placementId: string,
  requestedStaffId: string | null,
  referenceMappingId: string | null,
): BatchRowDraft {
  return {
    rowKey: globalThis.crypto.randomUUID(),
    placementId,
    input: {
      placementSource: source,
      entryPointType: "sales",
      propertyId: offer.propertyId,
      publicListingNo: offer.publicListingNo,
      dealType: offer.dealType,
      requestedStaffId,
      referenceMappingId,
      externalListingId: source === "28hse" ? placementId : null,
      videoId: source === "youtube" ? placementId : null,
      placementVerified: false,
      enabled: true,
    },
  };
}

export function expandBatchDraft(
  offers: LinkOfferSelection[],
  sources: ImportSource[],
  placements: Record<string, string>,
): DraftExpansion {
  const rowCount = offers.length * sources.length;
  const errors: ImportError[] = [];
  if (rowCount > 1000)
    return {
      rows: [],
      errors: [{ row: 0, column: "row", errorCode: "BATCH_LIMIT" }],
      offerCount: offers.length,
      rowCount,
    };
  if (new Set(sources).size !== sources.length)
    errors.push({ row: 0, column: "source", errorCode: "DUPLICATE_SOURCE" });
  const rows: BatchRowDraft[] = [];
  offers.forEach((offer, index) => {
    sources.forEach((source) => {
      const raw = placements[offer.propertyId + ":" + source] ?? "";
      const parsed = parsePlacementInput(source, raw);
      if ("errorCode" in parsed) {
        errors.push({ row: index + 1, column: source, errorCode: parsed.errorCode, value: raw });
      } else if (source === "28hse" && urlDealType(raw) && urlDealType(raw) !== offer.dealType) {
        errors.push({
          row: index + 1,
          column: source,
          errorCode: "DEAL_TYPE_MISMATCH",
          value: raw,
        });
      } else {
        rows.push(batchRow(offer, source, parsed.placementId, null, null));
      }
    });
  });
  return { rows, errors, offerCount: offers.length, rowCount };
}

export function resolveImportedRows(
  imported: ImportRow[],
  offers: LinkOfferSelection[],
  references: ImportReference[],
): { rows: BatchRowDraft[]; errors: ImportError[] } {
  const rows: BatchRowDraft[] = [];
  const errors: ImportError[] = [];
  if (imported.length > 1000)
    return {
      rows,
      errors: [{ row: 0, column: "row", errorCode: "BATCH_LIMIT" }],
    };
  const seen = new Set<string>();
  imported.forEach((item, index) => {
    const row = item.line ?? index + 2;
    const matches = offers.filter(
      (offer) =>
        offer.publicListingNo.toUpperCase() === item.publicListingNo.toUpperCase() &&
        offer.dealType === item.dealType,
    );
    if (matches.length !== 1) {
      errors.push({
        row,
        column: "public_listing_no",
        errorCode: matches.length ? "OFFER_AMBIGUOUS" : "OFFER_NOT_FOUND",
      });
      return;
    }
    const placement = parsePlacementInput(item.source, item.placementInput);
    if ("errorCode" in placement) {
      errors.push({ row, column: "placement_url_or_id", errorCode: placement.errorCode });
      return;
    }
    if (
      item.source === "28hse" &&
      urlDealType(item.placementInput) &&
      urlDealType(item.placementInput) !== item.dealType
    ) {
      errors.push({ row, column: "deal_type", errorCode: "DEAL_TYPE_MISMATCH" });
      return;
    }
    let reference: ImportReference | null = null;
    if (item.staffReference) {
      const separator = item.staffReference.indexOf("|");
      const namespace = item.staffReference.slice(0, separator);
      const externalReference = item.staffReference.slice(separator + 1);
      const candidates =
        separator > 0 && namespace.startsWith(item.source + "/")
          ? references.filter(
              (entry) =>
                entry.valid &&
                entry.namespace === namespace &&
                entry.externalReference === externalReference,
            )
          : [];
      if (candidates.length !== 1) {
        errors.push({
          row,
          column: "staff_reference",
          errorCode: candidates.length ? "STAFF_REFERENCE_CONFLICT" : "STAFF_REFERENCE_UNRESOLVED",
        });
        return;
      }
      reference = candidates[0];
    }
    const identity = JSON.stringify([
      item.publicListingNo,
      item.dealType,
      item.source,
      placement.placementId,
      reference?.id,
    ]);
    if (seen.has(identity)) {
      errors.push({ row, column: "row", errorCode: "DUPLICATE_ROW" });
      return;
    }
    seen.add(identity);
    rows.push(
      batchRow(
        matches[0],
        item.source,
        placement.placementId,
        reference?.staffId ?? null,
        reference?.id ?? null,
      ),
    );
  });
  return { rows, errors };
}
