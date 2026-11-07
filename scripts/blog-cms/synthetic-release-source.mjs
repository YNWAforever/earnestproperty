// Portable owned-database fixture. Never evidence of captured production content.
export function syntheticReleaseSource() {
  const categories = [
    "買樓攻略",
    "租樓攻略",
    "屋苑開箱",
    "屋苑比較",
    "成交分析",
    "社區生活",
    "市場評論",
  ];
  const origin = "https://synthetic.example.invalid";
  const observedAtUtc = "2026-11-05T00:00:00.000Z";
  const registry = Array.from({ length: 112 }, (_, i) => ({
    slug: `synthetic-release-${i + 1}`,
    title: `Synthetic article ${i + 1}`,
    excerpt: "Synthetic excerpt",
    category: categories[i % categories.length],
    readingMinutes: 5,
    author: "Synthetic author",
    reviewer: null,
    sourcesNote: "Synthetic fixture",
    answerSummary: "Synthetic summary",
    sections: [{ heading: "Synthetic heading", paragraphs: [`Synthetic body ${i + 1}`] }],
    links: [],
    ...(i < 2 ? {} : { publishedAt: observedAtUtc }),
  }));
  const urls = [
    ...registry.map((a) => `${origin}/blog/${a.slug}`),
    `${origin}/blog/editorial-standards`,
  ];
  return Buffer.from(
    JSON.stringify({
      sourceRevision: "synthetic-owned-release-v1",
      registry,
      sitemap: {
        httpStatus: 200,
        articleCount: urls.length,
        urls,
        observedAtUtc,
        source: `${origin}/sitemap.xml`,
      },
      presentation: {
        observedAtUtc,
        navigationCategoryKeys: categories,
        pages: [null, ...categories].map((categoryKey) => ({
          categoryKey,
          url: `${origin}/blog${categoryKey === null ? "" : "?category=" + encodeURIComponent(categoryKey)}`,
          status: 200,
          heading: "Synthetic blog",
          paragraphCandidates: ["市場分析 Blog", "Synthetic introduction"],
          title: "Synthetic title",
          description: "Synthetic description",
          canonical: `${origin}/blog`,
        })),
      },
    }),
  );
}
