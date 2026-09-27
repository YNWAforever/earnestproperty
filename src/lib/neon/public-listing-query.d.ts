export declare const CURRENT_PUBLIC_OFFERING_ORDER: string;
export declare const LISTING_FRESHNESS_ORDER: string;
export declare function canonicalListingCte(
  where: string,
  splitByDeal?: boolean,
  candidateOrder?: string,
): string;
