export type SchoolNet = {
  netCode: string;
  districtLabel: string;
  primarySchools: Array<{ name: string; type: string }>;
  source: string;
  sourceUrl: string | null;
  verifiedOn: string | null;
  admissionYear: string | null;
};

/**
 * Deliberately empty primarySchools on both nets: no Education Bureau
 * 《小一入學統一派位選校名冊》/ 學校網名冊 source has been supplied (open
 * input #6 in docs/superpowers/plans/2026-08-28-frontend-revamp.md). Populate
 * primarySchools, source, sourceUrl, verifiedOn and admissionYear together,
 * from the EDB register only, once it is supplied -- do not add named
 * schools from any other source (property portals, blogs, agent knowledge).
 * Net 71 added 2026-09-01 for the 12 青山公路 estates from the 17-estate
 * expansion data pack.
 */
export const schoolNets: Record<string, SchoolNet> = {
  "62": {
    netCode: "62",
    districtLabel: "荃灣",
    primarySchools: [],
    source: "教育局",
    sourceUrl: null,
    verifiedOn: null,
    admissionYear: null,
  },
  "71": {
    netCode: "71",
    districtLabel: "屯門",
    primarySchools: [],
    source: "教育局",
    sourceUrl: null,
    verifiedOn: null,
    admissionYear: null,
  },
};

/** Returns `null` for an unknown or missing code -- callers must omit the
 * school-net section entirely on `null`, matching this repo's established
 * "hide, don't show an empty label" convention (see
 * `findCastlePeakRoadSegmentByDistrictSlug`'s own doc comment for the same
 * pattern). */
export function getSchoolNet(code: string | null | undefined): SchoolNet | null {
  if (!code) return null;
  return schoolNets[code] ?? null;
}
