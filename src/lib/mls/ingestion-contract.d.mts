import type { UnitIdentity } from "./unit-identity.mjs";
export const POLICY_VERSION: "no-hermes-v2";
export const BRANCHES: readonly string[];
export class SnapshotError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;
  constructor(code: string, status?: number, details?: Record<string, unknown>);
}
export type SourceRecord = {
  key: string;
  source: string;
  externalId: string;
  advertisementId: string;
  dealType: "sale" | "rent";
  sourceUrl: string;
  propertyNo: null;
  identity: UnitIdentity;
  unitKey: string | null;
  sourceIdentityValid: boolean;
  sourceOccurrences: Array<{
    index: number;
    branch: string | null;
    sourceUrl: string;
    raw: Record<string, unknown>;
  }>;
  urlIdentityVerified: boolean;
  offerValid: boolean;
  exactMatchEligible: boolean;
  publicationEligible: boolean;
  publicationReasons: string[];
  fields: Record<string, string | number | null>;
  raw: Record<string, unknown>;
  branches: string[];
  contact: { name: string | null; licence: string | null; phone: string | null };
  index: number;
};
export type DecodedSnapshot = {
  source: string;
  wireSource: string;
  scopeId: string;
  policyVersion: string;
  parserVersion: string;
  scrapedAt: string;
  runId: string;
  hash: string;
  payload: Record<string, unknown>;
  meta: Record<string, unknown>;
  records: SourceRecord[];
  rejects: Array<{ row_index: number; code: string }>;
  duplicates: number;
  received: number;
  advertisementCount: number;
  offerCount: number;
};
export function canonicalJson(value: unknown): string;
export function hashPayload(value: unknown): string;
export function normalizeDecimal(value: unknown): string | null;
export function cleanSourceId(
  source: string,
  value: unknown,
  branch?: string,
  idScope?: string,
): string;
export function decodeSnapshot(
  input: unknown,
  options?: {
    idScope?: string;
    aliases?: Record<string, string>;
    verifySourceUrl?: (record: Record<string, unknown>, url: URL) => boolean;
  },
): DecodedSnapshot;
