import "@tanstack/react-start/server-only";
import { queryRows } from "./db.server";
import { publicBlogRead } from "./blog-public.server";

/** Compatibility allowlist: only a due live DB publication can authorize a link. */
export async function filterPublicBlogSlugs(
  slugs: string[],
  now: Date = new Date(),
): Promise<string[]> {
  if (!slugs.length) return [];
  return publicBlogRead(async () => {
    const rows = await queryRows(
      `SELECT slug FROM articles WHERE slug=ANY($1::text[])
      AND published = true AND (published_at IS NULL OR published_at <= $2::timestamptz)
      AND slug <> 'editorial-standards'`,
      [slugs, now.toISOString()],
    );
    const allowed = new Set(rows.map((row) => String(row.slug)));
    return slugs.filter((slug) => allowed.has(slug));
  });
}
