export function lastmodFor(
  path: string,
  sources: {
    listings: Map<string, string | null>;
    estates: Record<string, string | null>;
    articles: Record<string, string | null>;
    staticArticles: Record<string, string>;
  },
): string | null;
