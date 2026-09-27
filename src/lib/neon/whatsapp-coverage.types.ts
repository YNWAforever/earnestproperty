import type { BatchRowDraft } from "../whatsapp-enquiries/link-batch-policy.ts";
import type { BatchPreview } from "./whatsapp-link-batches.types.ts";

export type WebsiteCoverageFilter = {
  dealType?: "sale" | "rent";
  q?: string;
  missingOnly?: boolean;
  /** Internal exact selection filter for preview; not exposed by the GET boundary. */
  propertyIds?: string[];
};
export type WebsiteCoverageItem = {
  propertyId: string;
  publicListingNo: string;
  dealType: "sale" | "rent";
  status: "covered" | "missing" | "conflicted";
  code: string | null;
};
export type WebsiteTrackingCoverage = {
  eligibleOffers: number;
  coveredOffers: number;
  missingOffers: number;
  conflictedOffers: number;
  checkedAt: string;
  trackingEnabled: boolean;
  truncated: boolean;
  items: WebsiteCoverageItem[];
};
export type CoverageBackfillPreview = {
  rows: BatchRowDraft[];
  preview: BatchPreview;
  excludedRowKeys: string[];
};
