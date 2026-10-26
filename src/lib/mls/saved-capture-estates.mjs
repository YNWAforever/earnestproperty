// Exact names/aliases, plus the approved capture labels below. No fuzzy
// parent/phase guessing: a phase string that is not an alias and not in
// CAPTURE_ESTATE_MAPPINGS stays unmatched.
const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");

// 28hse card labels for phase-merged production estates. The estates.aliases
// values are the doubled portal forms ("黃金海灣 黃金海灣意嵐" /
// "黃金海灣黃金海灣意嵐", "帝御 帝御‧嵐天" / "帝御帝御‧嵐天", and the 珀岸 / 星濤
// parallels). Capture text uses the short form ("黃金海灣意嵐", "意嵐",
// "帝御‧嵐天", "嵐天"). Keys are already normalize()'d. A label maps only when
// that slug is present in the catalog with the same district_slug.
const phase = (slug) => ({ slug, district_slug: "castle-peak-road" });
export const CAPTURE_ESTATE_MAPPINGS = {
  黃金海灣意嵐: phase("wong-gam-hoi-waan"),
  意嵐: phase("wong-gam-hoi-waan"),
  黃金海灣珀岸: phase("wong-gam-hoi-waan"),
  珀岸: phase("wong-gam-hoi-waan"),
  "黃金海灣 黃金海灣意嵐": phase("wong-gam-hoi-waan"),
  黃金海灣黃金海灣意嵐: phase("wong-gam-hoi-waan"),
  "黃金海灣 黃金海灣珀岸": phase("wong-gam-hoi-waan"),
  黃金海灣黃金海灣珀岸: phase("wong-gam-hoi-waan"),
  "帝御‧嵐天": phase("tai-yu"),
  嵐天: phase("tai-yu"),
  帝御嵐天: phase("tai-yu"),
  "帝御‧星濤": phase("tai-yu"),
  星濤: phase("tai-yu"),
  帝御星濤: phase("tai-yu"),
  "帝御 帝御‧嵐天": phase("tai-yu"),
  "帝御帝御‧嵐天": phase("tai-yu"),
  "帝御 帝御‧星濤": phase("tai-yu"),
  "帝御帝御‧星濤": phase("tai-yu"),
};

export function captureEstateMapping(rawLabel) {
  return CAPTURE_ESTATE_MAPPINGS[normalize(rawLabel)] ?? null;
}

export function resolveSavedEstate(record, extras, estates, districts) {
  const rawDistrict = normalize(record.district);
  let candidates = districts.filter((d) =>
    [d.slug, d.name_zh, d.name_en].some((n) => n && normalize(n) === rawDistrict),
  );
  if (!candidates.length) {
    // Captured platform district labels explicitly contain these local areas.
    candidates = districts.filter((d) => d.name_zh && rawDistrict.includes(normalize(d.name_zh)));
  }
  if (!candidates.length) {
    // A specific named area in the captured address can resolve a broad district.
    const address = normalize(extras?.address);
    candidates = districts.filter((d) => d.name_zh && address.includes(normalize(d.name_zh)));
    if (candidates.some((d) => d.slug !== "castle-peak-road"))
      candidates = candidates.filter((d) => d.slug !== "castle-peak-road");
  }
  const district = candidates.length === 1 ? candidates[0] : null;
  const label = normalize(record.estate);
  const mapped = CAPTURE_ESTATE_MAPPINGS[label] ?? null;
  const named = estates.filter((e) => {
    const exact = [e.name_zh, e.name_en, ...(Array.isArray(e.aliases) ? e.aliases : [])].some(
      (n) => n && normalize(n) === label,
    );
    const approved =
      mapped !== null && e.slug === mapped.slug && e.district_slug === mapped.district_slug;
    return exact || approved;
  });
  const matches = district ? named.filter((e) => e.district_slug === district.slug) : [];
  return {
    label: record.estate ?? null,
    districtLabel: record.district ?? null,
    status:
      matches.length === 1 ? "matched" : matches.length > 1 ? "ambiguous" : "unmatched-left-null",
    estate_id: matches.length === 1 ? matches[0].id : null,
    slug: matches.length === 1 ? matches[0].slug : null,
    district_slug: district?.slug ?? null,
    candidates: matches.map((e) => ({ id: e.id, slug: e.slug })),
    reason: !district
      ? "district_unresolved"
      : matches.length > 1
        ? "multiple_exact_estates"
        : matches.length === 1
          ? "exact_name_or_alias_and_district"
          : "no_exact_estate_in_district",
  };
}
export async function readSavedEstateCatalog(query) {
  return {
    estates: (
      await query(
        "SELECT /* saved_capture_estates */ id,slug,name_zh,name_en,aliases,district_slug FROM estates",
      )
    ).rows,
    districts: (
      await query("SELECT /* saved_capture_districts */ id,slug,name_zh,name_en FROM districts")
    ).rows,
  };
}
