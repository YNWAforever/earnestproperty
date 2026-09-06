import { canonicalJson } from "./ingestion-contract.mjs";
const PRIMARY = "28hse_agent_540";
const FILLABLE = new Set(["gross_area", "saleable_area", "bedrooms"]);
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
  if (
    primaries.length > 1 ||
    secondaries.length > 1 ||
    [...primaries, ...secondaries].some((s) => !["active", "delisted"].includes(s.source_status))
  )
    return { values: {}, provenance: {}, conflicts: [], ambiguous: true, lifecycle: null };
  const primary = primaries[0],
    secondary = secondaries[0],
    values = {},
    provenance = {},
    conflicts = [];
  for (const field of FIELDS) {
    const p = primary?.fields?.[field],
      s = secondary?.fields?.[field];
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
        reason: winner === primary || !primary ? "primary" : "fill_missing",
      };
    }
    if (present(p) && present(s) && canonicalJson(p) !== canonicalJson(s))
      conflicts.push({
        field,
        primaryValue: p,
        secondaryValue: s,
        primaryObservationId: primary.observation_id,
        secondaryObservationId: secondary.observation_id,
        primaryObservedAt: primary.last_accepted_at,
        secondaryObservedAt: secondary.last_accepted_at,
        resolution: "keep_28hse",
      });
  }
  return {
    values,
    provenance,
    conflicts,
    ambiguous: false,
    lifecycle:
      primary?.source_status === "delisted"
        ? "inactive"
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
      const age = time - Date.parse(s.last_accepted_at);
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
        String(b.last_accepted_at).localeCompare(String(a.last_accepted_at)),
    );
  return usable.length
    ? {
        source: usable[0].source,
        observationId: usable[0].observation_id,
        observedAt: usable[0].last_accepted_at,
        contact: { ...usable[0].contact },
      }
    : null;
}
