// Exact names/aliases only; no parent/phase or fuzzy estate identities.
const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
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
  const named = estates.filter((e) =>
    [e.name_zh, e.name_en, ...(Array.isArray(e.aliases) ? e.aliases : [])].some(
      (n) => n && normalize(n) === label,
    ),
  );
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
