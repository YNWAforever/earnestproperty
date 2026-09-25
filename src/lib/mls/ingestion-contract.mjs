import { PROMOTION_TIERS, normalize28HsePromotionTier } from "./promotion-tier.mjs";
import { createHash } from "node:crypto";
import { exactUnitIdentity } from "./unit-identity.mjs";
export const POLICY_VERSION = "no-hermes-v2";
export const BRANCHES = Object.freeze(["EPW", "EPS", "EPT"]);
export class SnapshotError extends Error {
  constructor(code, status = 400, details = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const hashPayload = (value) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
export function normalizeDecimal(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
  )
    return null;
  let s = String(value).trim();
  if (!/^\d{1,16}(?:\.\d{1,8})?$/.test(s)) return null;
  s = s
    .replace(/^0+(?=\d)/, "")
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
  return s;
}
export function cleanSourceId(source, value, branch, idScope) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 160 ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new SnapshotError("invalid_source_id");
  const raw = value.trim();
  if (source === "28hse_agent_540") {
    if (!/^#?\d+$/.test(raw)) throw new SnapshotError("invalid_source_id");
    return raw.replace(/^#/, "");
  }
  if (!["global", "branch"].includes(idScope)) throw new SnapshotError("id_scope_unverified", 503);
  return idScope === "branch" ? JSON.stringify([branch, raw]) : raw;
}
export function decodeSnapshot(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new SnapshotError("invalid_envelope");
  const b = JSON.parse(JSON.stringify(input));
  const source =
    b.source === "28hse" ? "28hse_agent_540" : b.source === "propertyhk" ? "propertyhk" : null;
  const scopeId = source === "propertyhk" ? "branches:EPW,EPS,EPT" : "agent:540";
  const m = b.meta;
  if (
    !source ||
    !Array.isArray(b.listings) ||
    b.listings.length > 10000 ||
    !m ||
    m.schema_version !== "2.0" ||
    m.scope_id !== scopeId ||
    m.policy_version !== POLICY_VERSION ||
    !text(m.run_id) ||
    !text(m.parser_version) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(m.run_id) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(m.parser_version)
  )
    throw new SnapshotError("invalid_envelope");
  // Preserve all six PostgreSQL fractional digits; never round a receipt key via Date.
  // Bound clock skew so future evidence cannot advance the accepted-snapshot watermark.
  if (
    typeof b.scraped_at !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(b.scraped_at) ||
    !Number.isFinite(Date.parse(b.scraped_at)) ||
    new Date(b.scraped_at).toISOString().slice(0, 19) !== b.scraped_at.slice(0, 19) ||
    Date.parse(b.scraped_at) > Date.now() + 5 * 60 * 1000
  )
    throw new SnapshotError("invalid_timestamp");
  if (
    source === "propertyhk" &&
    (!Array.isArray(b.branches) ||
      canonicalJson([...b.branches].sort()) !== canonicalJson([...BRANCHES].sort()))
  )
    throw new SnapshotError("invalid_branches");
  for (const key of [
    "publish",
    "publish_enabled",
    "mode",
    "target_property_id",
    "baseline_approved",
    "staff_override",
  ])
    if (Object.hasOwn(b, key) || Object.hasOwn(m, key))
      throw new SnapshotError("forbidden_authority");
  const records = [],
    rejects = [],
    seen = new Map();
  let duplicates = 0;
  for (const [index, r] of b.listings.entries()) {
    try {
      if (!r || typeof r !== "object" || Array.isArray(r))
        throw new SnapshotError("invalid_record");
      for (const k of [
        "property_uuid",
        "target_property_id",
        "property_no",
        "canonical_property_no",
        "agent_id",
        "active_override",
        "publish",
      ])
        if (Object.hasOwn(r, k)) throw new SnapshotError("forbidden_record_authority");
      if (source === "propertyhk" && !BRANCHES.includes(r.branch_code))
        throw new SnapshotError("invalid_branch");
      if (!["sale", "rent"].includes(r.deal_type)) throw new SnapshotError("invalid_deal_type");
      // 28Hse's paid placement grade, as observed on the agent index. Present
      // (even as "") means the crawler actually looked at a parsed index, so an
      // empty badge is a real "ordinary" observation. Absent entirely -- every
      // propertyhk record, and any older payload -- stays `unknown`, which the
      // homepage feed sorts last and never badges as a paid tier.
      const promotion = Object.hasOwn(r, "promotion_tier_raw")
        ? normalize28HsePromotionTier(r.promotion_tier_raw, { badgeObserved: true })
        : { tier: PROMOTION_TIERS.UNKNOWN, raw: null };

      const sourceStatus = Object.hasOwn(r, "source_status") ? r.source_status : "active";
      const sourceStatusReason = r.source_status_reason ?? null;
      if (
        !["active", "delisted"].includes(sourceStatus) ||
        (sourceStatus === "active" && sourceStatusReason !== null) ||
        (sourceStatus === "delisted" &&
          sourceStatusReason !== (r.deal_type === "sale" ? "sold" : "rented"))
      )
        throw new SnapshotError("invalid_source_lifecycle");
      const externalId = cleanSourceId(source, r.property_id, r.branch_code, options.idScope);
      let url;
      try {
        url = new URL(r.source_url);
      } catch {
        throw new SnapshotError("invalid_source_url");
      }
      const hosts =
        source === "propertyhk" ? ["www.property.hk", "property.hk"] : ["www.28hse.com"];
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !hosts.includes(url.hostname)
      )
        throw new SnapshotError("invalid_source_url");
      let urlIdentityVerified = false;
      if (source === "28hse_agent_540") {
        const path = url.pathname.match(/^\/(buy|rent)\/[^/%]+\/property-(\d+)\/?$/);
        if (
          !path ||
          path[2] !== externalId ||
          path[1] !== (r.deal_type === "sale" ? "buy" : "rent") ||
          url.search ||
          url.hash
        )
          throw new SnapshotError("source_url_identity_mismatch");
        urlIdentityVerified = true;
      } else urlIdentityVerified = options.verifySourceUrl?.(r, url) === true;
      const fields = {};
      for (const k of [
        "price",
        "rent",
        "gross_area",
        "saleable_area",
        "gross_unit_price",
        "saleable_unit_price",
      ]) {
        fields[k] = normalizeDecimal(r[k]);
        if (r[k] != null && r[k] !== "" && r[k] !== "面議" && fields[k] === null)
          throw new SnapshotError(`invalid_${k}`);
      }
      for (const k of ["bedrooms", "bathrooms"]) {
        fields[k] = r[k] ?? null;
        if (
          fields[k] !== null &&
          (!Number.isInteger(fields[k]) || fields[k] < 0 || fields[k] > 100)
        )
          throw new SnapshotError(`invalid_${k}`);
      }
      for (const k of [
        "title",
        "description",
        "estate",
        "district",
        "phase",
        "block",
        "floor",
        "unit",
        "orientation",
        "estate_type",
        "developer",
      ])
        fields[k] = text(r[k]);
      const memberships = source === "propertyhk" ? (r.branch_memberships ?? [r.branch_code]) : [];
      if (
        !Array.isArray(memberships) ||
        memberships.some((v) => !BRANCHES.includes(v)) ||
        (source === "propertyhk" && !memberships.includes(r.branch_code))
      )
        throw new SnapshotError("invalid_memberships");
      const agencyPropertyNo = r.agency_property_no ?? null;
      if (
        agencyPropertyNo !== null &&
        (typeof agencyPropertyNo !== "string" || !/^[A-Z][0-9]{6}$/.test(agencyPropertyNo))
      )
        throw new SnapshotError("invalid_agency_property_no");
      const identity = exactUnitIdentity(r, options.aliases);
      const key = JSON.stringify([source, externalId, r.deal_type]);
      const record = {
        key,
        source,
        externalId,
        advertisementId: externalId,
        dealType: r.deal_type,
        sourceUrl: url.href,
        sourceStatus,
        sourceStatusReason,
        promotionTier: promotion.tier,
        promotionTierRaw: promotion.raw,
        propertyNo: null,
        agencyPropertyNo,
        identity,
        unitKey: urlIdentityVerified ? identity.key : null,
        sourceIdentityValid: true,
        sourceOccurrences: [{ index, branch: r.branch_code ?? null, sourceUrl: url.href, raw: r }],
        urlIdentityVerified,
        offerValid:
          sourceStatus === "active" &&
          Number(fields[r.deal_type === "sale" ? "price" : "rent"]) > 0,
        exactMatchEligible: urlIdentityVerified && identity.key !== null,
        publicationEligible: false,
        publicationReasons: [
          ...(sourceStatus === "delisted" ? ["source_terminal"] : []),
          ...(!urlIdentityVerified ? ["source_url_identity_unverified"] : []),
          ...(!(Number(fields[r.deal_type === "sale" ? "price" : "rent"]) > 0)
            ? ["missing_offer_amount"]
            : []),
          ...(!fields.title ? ["missing_title"] : []),
          ...(!fields.district ? ["missing_district"] : []),
          "owned_media_review_required",
        ],
        fields,
        raw: r,
        branches: [...new Set(memberships)].sort(),
        contact: {
          name: text(r.agent_name),
          licence: text(r.agent_license),
          phone: text(r.agent_phone),
        },
        index,
      };
      const fingerprint = hashPayload({
        agencyPropertyNo,
        source,
        externalId,
        dealType: r.deal_type,
        fields,
        sourceStatus,
        sourceStatusReason,
        contact: record.contact,
      });
      if (seen.has(key)) {
        const previous = seen.get(key);
        duplicates++;
        if (previous.fingerprint === fingerprint) {
          previous.record.sourceOccurrences.push(...record.sourceOccurrences);
          previous.record.branches = [
            ...new Set([...previous.record.branches, ...record.branches]),
          ].sort();
        }
        if (previous.fingerprint !== fingerprint) {
          rejects.push({ row_index: index, code: "conflicting_duplicate_source_id" });
          if (!previous.conflict) {
            rejects.push({
              row_index: previous.record.index,
              code: "conflicting_duplicate_source_id",
            });
            previous.conflict = true;
          }
        }
      } else {
        seen.set(key, { record, fingerprint, conflict: false });
      }
    } catch (e) {
      if (!(e instanceof SnapshotError)) throw e;
      if (e.status === 503) throw e;
      rejects.push({ row_index: index, code: e.code });
    }
  }
  for (const entry of seen.values()) if (!entry.conflict) records.push(entry.record);
  return {
    source,
    wireSource: b.source,
    scopeId,
    policyVersion: POLICY_VERSION,
    parserVersion: m.parser_version,
    scrapedAt: b.scraped_at,
    runId: m.run_id,
    hash: hashPayload(b),
    payload: b,
    meta: m,
    records,
    rejects,
    duplicates,
    received: b.listings.length,
    advertisementCount: new Set(records.map((r) => r.advertisementId)).size,
    offerCount: records.length,
  };
}
