import { canonicalJson } from "./ingestion-contract.mjs";
import { SOURCE_28HSE } from "./source-contract.mjs";
import { sourceAuthorityPolicy } from "./source-authority-policy.mjs";
import { validIncrementalTimestamp } from "./incremental-contract.mjs";
const PRIMARY = SOURCE_28HSE;
const FILLABLE = new Set(["gross_area", "saleable_area", "bedrooms"]);
const NULLABLE_FIELDS = new Set([
  "description",
  "floor",
  "price",
  "rent",
  "gross_area",
  "saleable_area",
  "bedrooms",
  "bathrooms",
  "orientation",
]);
const FIELDS = [
  "title",
  "description",
  "estate",
  "district",
  "phase",
  "block",
  "floor",
  "unit",
  "price",
  "rent",
  "gross_unit_price",
  "saleable_unit_price",
  "gross_area",
  "saleable_area",
  "bedrooms",
  "bathrooms",
  "orientation",
  "estate_type",
  "developer",
];
const present = (v) => v !== null && v !== undefined && v !== "";
const MATERIAL = [
  "estate",
  "district",
  "phase",
  "block",
  "floor",
  "unit",
  "price",
  "rent",
  "gross_area",
  "saleable_area",
  "bedrooms",
  "bathrooms",
];
function equivalentPropertyhk(sources) {
  const first = sources[0];
  return Boolean(
    first?.unit_key &&
    first.source === "propertyhk" &&
    ["sale", "rent"].includes(first.deal_type) &&
    ["active", "delisted"].includes(first.source_status) &&
    sources.every(
      (s) =>
        s.source === "propertyhk" &&
        s.unit_key === first.unit_key &&
        s.deal_type === first.deal_type &&
        s.source_status === first.source_status &&
        (s.source_status_reason ?? null) === (first.source_status_reason ?? null) &&
        FIELDS.every(
          (k) => canonicalJson(s.fields?.[k] ?? null) === canonicalJson(first.fields?.[k] ?? null),
        ),
    ),
  );
}
function capture(source) {
  // pg's Date conversion drops microseconds. The ingestion query supplies the
  // exact observation timestamp as captured_at; other callers may supply UTC text.
  const stamp = source.captured_at ?? source.fetched_at;
  return validIncrementalTimestamp(stamp) ? stamp : null;
}
function captureOrder(source) {
  const stamp = capture(source);
  return stamp.slice(0, 19) + "." + (stamp.match(/\.(\d+)Z$/)?.[1] ?? "").padEnd(6, "0");
}
function primaryAuthority(sources) {
  if (!sources.length) return null;
  const ref = sources[0].raw_identity?.agency_property_no;
  const deal = sources[0].deal_type;
  if (typeof ref !== "string" || !/^[A-Z][0-9]{6}$/.test(ref) || !["sale", "rent"].includes(deal))
    return null;
  let rule;
  for (const source of sources) {
    if (
      source.raw_identity?.agency_property_no !== ref ||
      source.deal_type !== deal ||
      !["active", "delisted"].includes(source.source_status) ||
      typeof source.external_listing_id !== "string" ||
      !/^\d{1,160}$/.test(source.external_listing_id) ||
      !capture(source)
    )
      return null;
    const approved = sourceAuthorityPolicy({ ...source, config: source.policy_config });
    if (!approved || (rule && canonicalJson(rule) !== canonicalJson(approved))) return null;
    rule = approved;
  }
  return new Set(sources.map((source) => source.external_listing_id)).size === sources.length
    ? rule
    : null;
}
function primaryAdvertisement(sources) {
  const authority = primaryAuthority(sources);
  const all = [...sources].sort((a, b) => {
    if (authority) {
      const time = captureOrder(b).localeCompare(captureOrder(a));
      if (time) return time;
      const left = BigInt(a.external_listing_id),
        right = BigInt(b.external_listing_id);
      if (left !== right) return left > right ? -1 : 1;
    }
    return String(a.external_listing_id).localeCompare(String(b.external_listing_id));
  });
  const active = all.filter((s) => s.source_status === "active");
  // Inferred absence is not a contradictory terminal statement.
  const eligible = active.length
    ? all.filter((s) => s.source_status === "active" || s.source_status_reason)
    : all;
  const conflicts = [];
  const first = eligible[0];
  for (const other of eligible.slice(1)) {
    for (const field of [
      ...(authority ? FIELDS : MATERIAL),
      "agency_property_no",
      "source_status",
    ]) {
      const get = (s) =>
        field === "agency_property_no"
          ? s.raw_identity?.agency_property_no
          : field === "source_status"
            ? s.source_status
            : s.fields?.[field];
      if (canonicalJson(get(first) ?? null) !== canonicalJson(get(other) ?? null))
        conflicts.push({
          field,
          primaryValue: get(first) ?? null,
          secondaryValue: get(other) ?? null,
          primaryObservationId: first.observation_id,
          secondaryObservationId: other.observation_id,
          primaryObservedAt: capture(first) ?? first.fetched_at,
          secondaryObservedAt: capture(other) ?? other.fetched_at,
          resolution: authority ? "keep_latest_28hse" : "hold_multi_ad",
          ...(authority
            ? {
                authority,
                primaryAdvertisementId: first.external_listing_id,
                secondaryAdvertisementId: other.external_listing_id,
              }
            : {}),
        });
    }
  }
  return { winner: first, conflicts, authority };
}
export function chooseRelationship(record, existing, candidates = []) {
  if (existing) {
    const old = existing.raw_identity ?? {};
    const changed = ["estate", "district", "phase", "block", "floor", "unit"].some(
      (k) => present(old[k]) && present(record.identity[k]) && old[k] !== record.identity[k],
    );
    return {
      propertyId: existing.property_id ?? null,
      reason: changed ? "identity_changed" : "source_id_v2",
      holdProjection: changed,
      unitKey: changed ? existing.unit_key : (record.unitKey ?? existing.unit_key),
    };
  }
  const sameSourceTargets = new Set(
    candidates
      .filter(
        (c) =>
          c.source === record.source &&
          c.deal_type === record.dealType &&
          c.unit_key === record.unitKey,
      )
      .map((c) => c.property_id),
  );
  if (
    record.source === "propertyhk" &&
    record.exactMatchEligible &&
    sameSourceTargets.size === 1 &&
    !candidates.some((c) => c.source !== record.source && sameSourceTargets.has(c.property_id)) &&
    [...sameSourceTargets][0] &&
    equivalentPropertyhk([
      {
        source: record.source,
        unit_key: record.unitKey,
        deal_type: record.dealType,
        fields: record.fields,
        source_status: record.sourceStatus,
        source_status_reason: record.sourceStatusReason,
      },
      ...candidates.filter(
        (c) =>
          c.source === record.source &&
          c.unit_key === record.unitKey &&
          c.deal_type === record.dealType,
      ),
    ])
  )
    return {
      propertyId: [...sameSourceTargets][0],
      reason: "equivalent_propertyhk_v1",
      holdProjection: false,
      unitKey: record.unitKey,
    };
  if (record.unitKey && sameSourceTargets.size)
    return {
      propertyId: null,
      reason: "same_source_duplicate",
      holdProjection: true,
      unitKey: record.unitKey,
      candidates: [...sameSourceTargets].filter(Boolean).sort(),
    };
  const eligible =
    record.unitKey && sameSourceTargets.size === 0
      ? candidates.filter(
          (c) =>
            c.unit_key === record.unitKey &&
            c.deal_type === record.dealType &&
            c.source !== record.source &&
            !sameSourceTargets.has(c.property_id) &&
            c.property_id,
        )
      : [];
  const ids = [...new Set(eligible.map((c) => c.property_id))];
  return {
    propertyId: ids.length === 1 ? ids[0] : null,
    reason:
      ids.length === 1 ? "exact_unit_v2" : ids.length > 1 ? "ambiguous_exact_unit" : "source_id_v2",
    holdProjection: false,
    unitKey: record.unitKey,
    candidates: ids,
  };
}
export function selectSourceFields(sources) {
  const primaries = sources.filter((s) => s.source === PRIMARY);
  const secondaries = sources.filter((s) => s.source === "propertyhk");
  const primaryChoice = primaryAdvertisement(primaries);
  const secondaryAmbiguous =
    (secondaries.length > 1 && !equivalentPropertyhk(secondaries)) ||
    secondaries.some((source) => !["active", "delisted"].includes(source.source_status));
  if (
    (!primaryChoice.authority && primaryChoice.conflicts.length > 0) ||
    (primaries.length > 1 &&
      !primaryChoice.authority &&
      primaries.some(
        (s) =>
          !s.raw_identity?.agency_property_no ||
          (s.policy_config && s.policy_config.company_number_identity?.approved !== true),
      )) ||
    (!primaryChoice.authority && secondaryAmbiguous) ||
    primaries.some((s) => !["active", "delisted"].includes(s.source_status))
  )
    return {
      values: {},
      clearFields: [],
      provenance: {},
      conflicts: primaryChoice.conflicts,
      ambiguous: true,
      lifecycle: null,
    };
  const primary = primaryChoice.winner,
    secondary = secondaryAmbiguous
      ? undefined
      : [...secondaries].sort((a, b) =>
          String(a.external_listing_id).localeCompare(String(b.external_listing_id)),
        )[0],
    values = {},
    provenance = {},
    conflicts = [...primaryChoice.conflicts],
    clearFields = [];
  for (const field of FIELDS) {
    // A saved partial capture retains its reviewed authority on every future selection.
    // An excluded primary field is not permission to fall back to another source.
    const allowed = (source) =>
      source?.projection == null ||
      (source.projection.mode === "controlled-patch-v1" &&
        Array.isArray(source.projection.fields) &&
        source.projection.fields.includes(field));
    if ((primary && !allowed(primary)) || (!primary && secondary && !allowed(secondary))) continue;
    const p = primary?.fields?.[field],
      s = allowed(secondary) ? secondary?.fields?.[field] : undefined;
    const winner = present(p)
      ? primary
      : (!primary || FILLABLE.has(field)) && present(s)
        ? secondary
        : null;
    if (winner) {
      values[field] = winner.fields[field];
      provenance[field] = {
        source: winner.source,
        observationId: winner.observation_id,
        reason:
          winner === primary && primaryChoice.authority
            ? "source_authority_latest"
            : winner === primary || !primary
              ? "primary"
              : "fill_missing",
      };
    }
    if (
      !winner &&
      NULLABLE_FIELDS.has(field) &&
      !(primaryChoice.authority && secondaryAmbiguous) &&
      !primary?.projection &&
      !secondary?.projection
    ) {
      clearFields.push(field);
      provenance[field] = { source: null, observationId: null, reason: "no_authorized_source" };
    }
    if (present(p) && present(s) && canonicalJson(p) !== canonicalJson(s))
      conflicts.push({
        field,
        primaryValue: p,
        secondaryValue: s,
        primaryObservationId: primary.observation_id,
        secondaryObservationId: secondary.observation_id,
        primaryObservedAt: primary.fetched_at,
        secondaryObservedAt: secondary.fetched_at,
        resolution: "keep_28hse",
      });
  }
  return {
    values,
    clearFields,
    provenance,
    conflicts,
    ambiguous: false,
    lifecycle:
      // Source state can be delisted independently by a later accepted full snapshot.
      primary?.source_status === "delisted"
        ? "inactive"
        : (primary ?? secondary)?.projection != null
          ? null
          : (primary ?? secondary)?.source_status === "active"
            ? "active"
            : null,
  };
}
export function selectWholeContact(
  sources,
  { now = new Date().toISOString(), maxAgeHours = 48 } = {},
) {
  const time = Date.parse(now);
  if (!Number.isFinite(time) || !Number.isFinite(maxAgeHours) || maxAgeHours <= 0) return null;
  const usable = sources
    .filter((s) => {
      const age = time - Date.parse(s.fetched_at);
      return (
        [PRIMARY, "propertyhk"].includes(s.source) &&
        s.source_status === "active" &&
        age >= 0 &&
        age <= maxAgeHours * 3600000 &&
        typeof s.contact?.name === "string" &&
        s.contact.name.trim() &&
        typeof s.contact?.phone === "string" &&
        /^[+()0-9 .-]{5,30}$/.test(s.contact.phone) &&
        s.contact.phone.replace(/\D/g, "").length >= 5
      );
    })
    .sort(
      (a, b) =>
        (a.source === PRIMARY ? 0 : 1) - (b.source === PRIMARY ? 0 : 1) ||
        String(b.fetched_at).localeCompare(String(a.fetched_at)),
    );
  return usable.length
    ? {
        source: usable[0].source,
        observationId: usable[0].observation_id,
        observedAt: usable[0].fetched_at,
        contact: { ...usable[0].contact },
      }
    : null;
}
