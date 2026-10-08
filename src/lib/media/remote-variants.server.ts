import "@tanstack/react-start/server-only";
import { queryRows } from "../neon/db.server";
import { lookupMediaVariantsForUrls } from "./remote-variants-db.mjs";
import type { VariantSet } from "./remote-variants.mjs";

type ImageRow = { images?: string[] | null; image_variants?: Record<string, VariantSet> };
export async function attachRemoteVariants<T extends ImageRow>(rows: T[]): Promise<T[]> {
  if (!rows.length) return rows;
  const urls = [...new Set(rows.flatMap((row) => row.images ?? []))].slice(0, 500);
  if (!urls.length) return rows;
  try {
    const sets = (await lookupMediaVariantsForUrls(
      (statement: string, params: unknown[]) => queryRows(statement, params),
      urls,
    )) as Record<string, VariantSet>;
    return rows.map((row) => ({
      ...row,
      image_variants: Object.fromEntries(
        (row.images ?? []).filter((url) => sets[url]).map((url) => [url, sets[url]]),
      ),
    }));
  } catch {
    // Missing migration or optional metadata failure must not hide a listing.
    return rows;
  }
}
export async function attachRemoteVariantsToSearch<T extends { rows: ImageRow[] }>(
  result: T,
): Promise<T> {
  return { ...result, rows: await attachRemoteVariants(result.rows) };
}
