import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { load } from "cheerio";

export const INDEX_SOURCES = [
  "https://www.earnestproperty.com/property/",
  "https://www.earnestproperty.com/property/c1/",
  "https://www.earnestproperty.com/property/c2/",
  "https://www.earnestproperty.com/property/c5/",
];

export function extractDetailUrls(html, baseUrl) {
  const $ = load(html);
  const urls = [];

  $("a[href*='/property-detail/']").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;

    const absolute = new URL(href, baseUrl).toString();
    if (/\/property-detail\/\d+\.html$/i.test(absolute)) urls.push(absolute);
  });

  return [...new Set(urls)];
}

export function extractMaxPage(html) {
  const matches = [...html.matchAll(/findForm_submit\(["']page["']\s*,\s*(\d+)\)/g)];
  const pages = matches.map((match) => Number(match[1])).filter(Number.isFinite);
  return pages.length ? Math.max(...pages) : 1;
}

export function buildPagedUrl(sourceUrl, page) {
  const url = new URL(sourceUrl);
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "EarnestPropertyMigrationBot/1.0" },
  });

  if (!response.ok) throw new Error(`Fetch failed ${response.status} ${url}`);
  return response.text();
}

export async function discoverSource(sourceUrl, { maxPages = 200, delayMs = 250 } = {}) {
  const discovered = new Map();
  let maxPage = 1;

  for (let page = 1; page <= Math.min(maxPage, maxPages); page += 1) {
    const pageUrl = buildPagedUrl(sourceUrl, page);
    const html = await fetchText(pageUrl);
    if (page === 1) maxPage = extractMaxPage(html);

    const urls = extractDetailUrls(html, pageUrl);
    for (const detailUrl of urls) {
      discovered.set(detailUrl, { sourceUrl, pageUrl, page });
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return [...discovered.entries()].map(([detailUrl, metadata]) => ({ detailUrl, ...metadata }));
}

export async function discoverAllSources(options = {}) {
  const records = [];

  for (const sourceUrl of INDEX_SOURCES) {
    records.push(...(await discoverSource(sourceUrl, options)));
  }

  const byUrl = new Map();
  for (const record of records) {
    const existing = byUrl.get(record.detailUrl);
    if (existing) existing.sourceIndexes.push(record.sourceUrl);
    else byUrl.set(record.detailUrl, { ...record, sourceIndexes: [record.sourceUrl] });
  }

  return [...byUrl.values()];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = join("artifacts", "old-site-migration", runId);

  await mkdir(outputDir, { recursive: true });
  const records = await discoverAllSources();
  await writeFile(join(outputDir, "discovered-detail-urls.json"), JSON.stringify(records, null, 2));
  console.log(JSON.stringify({ runId, outputDir, detailUrls: records.length }, null, 2));
}
