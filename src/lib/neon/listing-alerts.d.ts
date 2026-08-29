export const LISTING_ALERT_CONSENT_TEXT: string;

export const LISTING_ALERT_CONSENT_VERSION: string;

export type ListingAlertFilters = Record<string, unknown>;

export type ListingAlertUtm = Record<string, string>;

export type ListingAlertPersistenceInput = {
  name: string;
  phone: string;
  email: string | null;
  filters: ListingAlertFilters;
  consentText: string;
  consentVersion: string;
  consentedAt: string;
  utm: ListingAlertUtm;
};

export type ListingAlertQuery = (
  sql: string,
  params: unknown[],
) => Promise<Array<Record<string, unknown>>>;

export function persistListingAlert(
  query: ListingAlertQuery,
  input: ListingAlertPersistenceInput,
): Promise<{ id: string }>;
