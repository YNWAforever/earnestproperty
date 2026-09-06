// Versioned exact identity. Alias maps are operator-owned, never supplied by a batch.
export function identityText(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase()
    : "";
}
export function exactUnitIdentity(raw, aliases = {}) {
  const estateRaw = identityText(raw.estate);
  const estate = Object.hasOwn(aliases, estateRaw) ? identityText(aliases[estateRaw]) : estateRaw;
  const district = identityText(raw.district);
  const phase = identityText(raw.phase);
  const block = identityText(raw.block)
    .replace(/^TOWER\s+/, "")
    .replace(/座$/, "")
    .trim();
  const floorRaw = identityText(raw.floor);
  const floor = /^(?:\d+|B\d+|G)(?:\/F|樓)?$/.test(floorRaw)
    ? floorRaw.replace(/(?:\/F|樓)$/, "")
    : "";
  const unit = identityText(raw.unit)
    .replace(/^FLAT\s+/, "")
    .replace(/室$/, "")
    .trim();
  const placeholder = /^(?:UNKNOWN|N\/A|NA|NULL|NONE|TBC|TBD|待定|不詳|未知|[-—?]+)$/;
  const eligible =
    [estate, district, block, floor, unit].every((v) => v && !placeholder.test(v)) &&
    ["sale", "rent"].includes(raw.deal_type);
  return {
    version: "exact-unit-v2",
    estate,
    district,
    phase,
    block,
    floor,
    unit,
    key: eligible
      ? JSON.stringify([district, estate, phase, block, floor, unit, raw.deal_type])
      : null,
  };
}
