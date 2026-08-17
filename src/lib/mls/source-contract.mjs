import { createHash } from "node:crypto";

export const SOURCE_OLD_SITE = "old_site";
export const SOURCE_28HSE = "28hse_agent_540";
export const DEAL_TYPES = Object.freeze(["sale", "rent"]);
export const MLS_PARSER_VERSION = "dual-source-v1";
export const OBSERVATION_SCHEMA_VERSION = 1;

export function normalizePropertyNo(value) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  return normalized && /^[A-Z0-9-]+$/.test(normalized) ? normalized : null;
}

export function buildMatchKey(propertyNo, dealType) {
  const normalized = normalizePropertyNo(propertyNo);
  return normalized && DEAL_TYPES.includes(dealType) ? `${dealType}:${normalized}` : null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

export function stableObservationHash(value) {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}

export function createObservation(input) {
  if (![SOURCE_OLD_SITE, SOURCE_28HSE].includes(input.source)) {
    throw new TypeError("Unsupported MLS source");
  }
  if (!DEAL_TYPES.includes(input.dealType) || !input.externalId || !input.sourceUrl) {
    throw new TypeError("Observation identity is incomplete");
  }
  const propertyNoNormalized = normalizePropertyNo(input.propertyNoRaw);
  const quarantineReasons = [...new Set(input.quarantineReasons ?? [])];
  if (!propertyNoNormalized) quarantineReasons.push("missing_or_invalid_property_number");
  const fields = input.fields ?? {};
  if (input.dealType === "sale" && !(Number(fields.price) > 0)) {
    quarantineReasons.push("missing_or_invalid_sale_price");
  }
  if (input.dealType === "rent" && !(Number(fields.rent) > 0)) {
    quarantineReasons.push("missing_or_invalid_rent");
  }
  const hashInput = {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    source: input.source,
    externalId: String(input.externalId),
    dealType: input.dealType,
    propertyNoNormalized,
    fields,
    rawFields: input.rawFields ?? {},
    mediaCandidates: input.mediaCandidates ?? [],
    sourceUpdatedAt: input.sourceUpdatedAt ?? null,
  };
  return Object.freeze({
    ...hashInput,
    sourceUrl: input.sourceUrl,
    propertyNoRaw: input.propertyNoRaw ?? null,
    matchKey: buildMatchKey(propertyNoNormalized, input.dealType),
    discoveredAt: input.discoveredAt ?? input.fetchedAt,
    fetchedAt: input.fetchedAt,
    contentHash: stableObservationHash(hashInput),
    validationState: quarantineReasons.length ? "quarantined" : "valid",
    quarantineReasons: [...new Set(quarantineReasons)],
    parseWarnings: [...new Set(input.parseWarnings ?? [])],
  });
}
