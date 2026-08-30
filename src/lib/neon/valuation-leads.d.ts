export const VALUATION_CONSENT_TEXT: string;

export const VALUATION_CONSENT_VERSION: string;

export type ValuationLeadUtm = Record<string, string>;

export type ValuationLeadPersistenceInput = {
  name: string;
  phone: string;
  email: string | null;
  propertyAddress: string;
  estateId: string | null;
  notes: string | null;
  consentText: string;
  consentVersion: string;
  consentedAt: string;
  utm: ValuationLeadUtm;
};

export type ValuationLeadQuery = (
  sql: string,
  params: unknown[],
) => Promise<Array<Record<string, unknown>>>;

export function persistValuationLead(
  query: ValuationLeadQuery,
  input: ValuationLeadPersistenceInput,
): Promise<{ id: string }>;
