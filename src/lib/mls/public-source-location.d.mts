export type PublicSourceLocation = { block: string | null; phase: string | null } | null;
export function readPublicSourceLocation(
  query: (statement: string, params?: unknown[]) => Promise<Record<string, unknown>[]>,
  propertyId: string,
  offeringIds: string[],
): Promise<PublicSourceLocation>;
