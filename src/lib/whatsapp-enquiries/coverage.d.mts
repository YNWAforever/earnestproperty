export type WebsiteCoverageRaw = {
  propertyId: unknown;
  publicListingNo: unknown;
  dealType: "sale" | "rent";
  candidateCount: number;
  code: unknown;
};
export type WebsiteCoverageItem = {
  propertyId: string;
  publicListingNo: string;
  dealType: "sale" | "rent";
  status: "covered" | "missing" | "conflicted";
  code: string | null;
};
export function classifyWebsiteCoverage(row: WebsiteCoverageRaw): WebsiteCoverageItem;
export function summarizeWebsiteCoverage(rows: WebsiteCoverageItem[]): {
  eligibleOffers: number;
  coveredOffers: number;
  missingOffers: number;
  conflictedOffers: number;
};
