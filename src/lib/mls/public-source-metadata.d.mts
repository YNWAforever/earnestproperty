export type PublicSourceMetadata = {
  source_contact: {
    source: string;
    observationId: string;
    observedAt: string;
    contact: { name: string | null; licence?: string | null; phone: string | null };
  } | null;
  source_freshness: Array<{ source: string; observed_at: string; status: string }>;
};
export function readPublicSourceMetadata(
  query: (statement: string, params?: unknown[]) => Promise<Record<string, unknown>[]>,
  propertyId: string,
  options?: { now?: string },
): Promise<PublicSourceMetadata>;
