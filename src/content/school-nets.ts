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
 * Deliberately empty primarySchools: no Education Bureau
 * 《小一入學統一派位選校名冊》/ 學校網名冊 source has been supplied (open
 * input #6 in docs/superpowers/plans/2026-08-28-frontend-revamp.md). The
 * previous hardcoded five-school list in district.sham-tseng.tsx was never
 * sourced from that register and is not carried forward. Populate
 * primarySchools, source, sourceUrl, verifiedOn and admissionYear together,
 * from the EDB register only, once it is supplied -- do not add named
 * schools from any other source (property portals, blogs, agent knowledge).
 */
export const shamTsengSchoolNet: SchoolNet = {
  netCode: "62",
  districtLabel: "荃灣",
  primarySchools: [],
  source: "教育局",
  sourceUrl: null,
  verifiedOn: null,
  admissionYear: null,
};
