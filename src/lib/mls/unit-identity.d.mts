export type UnitIdentity = {
  version: string;
  estate: string;
  district: string;
  phase: string;
  block: string;
  floor: string;
  unit: string;
  key: string | null;
};
export function identityText(value: unknown): string;
export function exactUnitIdentity(
  raw: Record<string, unknown>,
  aliases?: Record<string, string>,
): UnitIdentity;
