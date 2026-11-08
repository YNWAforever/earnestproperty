/**
 * Turn a pasted article link into a draft blog post.
 *
 * Staff only have the link: the flow is "paste link → draft appears in the editor → staff
 * reviews and publishes". This module is the pure half (HTML → metadata + paragraphs →
 * `ArticleInput`); the server function in `blog-admin.server.ts` does the bounded fetch and
 * the category lookup, and the existing repository writes the draft.
 *
 * ## What "link back to the original post" means
 *
 * The source URL becomes a supplemental link (`原文：<site>`) plus the editorial
 * `sourcesNote`, both of which the public article page renders — the published post always
 * points back to where the story came from. The URL is never rewritten or shortened.
 *
 * ## Extraction is deliberately conservative
 *
 * There is no readability library here: known article containers are tried first (on.cc's
 * `breakingNewsContent` paragraph blocks, then `<article>`, then `<p>` tags, then the raw
 * body text). If nothing usable comes out, the server function fails the request instead of
 * creating an empty draft. Keeping the parser in a plain module means `bun test` can pin it
 * with a fixture, and the browser-side schema can reuse `isAllowedImportUrl` without
 * pulling in a Node dependency.
 */
import { isSafeArticleUrl } from "./content";
import type { ArticleInput } from "./types";

export type LinkImportSource = {
  url: string;
  title: string;
  excerpt: string;
  imageUrl: string | null;
  siteName: string | null;
  paragraphs: string[];
};

const MAX_TITLE = 500;
const MAX_EXCERPT = 500;
const MAX_PARAGRAPHS = 80;
const MAX_BODY_CHARS = 40_000;

/**
 * The URL a server may fetch. Public https article pages only: no credentials, no
 * localhost/.local, no private/loopback/link-local IP literals. This blocks the obvious
 * SSRF targets; DNS-based rebinding is out of scope for a staff-only, allow-by-URL tool
 * (the fetched page is only ever turned into text and an image URL).
 */
export function isAllowedImportUrl(value: string): boolean {
  if (!isSafeArticleUrl(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (!host || !host.includes(".") || host.endsWith(".")) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (host.includes(":") || host.startsWith("[")) return false; // IPv6 literals
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (octets) {
    const [a, b] = [Number(octets[1]), Number(octets[2])];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}

function decodeEntities(input: string): string {
  return input
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&[a-z][a-z0-9]+;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function metaContent(html: string, key: string): string | null {
  const wanted = key.toLowerCase();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (name?.toLowerCase() !== wanted) continue;
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (content != null) return decodeEntities(content);
  }
  return null;
}

function titleTag(html: string): string | null {
  const raw = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return raw ? decodeEntities(raw) : null;
}

/** Strip the "｜section｜site" suffix news sites append to `<title>`; og:title is preferred. */
export function cleanLinkImportTitle(raw: string, siteName: string | null): string {
  let title = decodeEntities(raw);
  const site = siteName?.trim() ?? "";
  if (title.includes("｜")) {
    const parts = title
      .split("｜")
      .map((part) => part.trim())
      .filter(Boolean);
    const tail = parts.slice(1);
    const looksLikeChrome =
      tail.length >= 2 ||
      tail.some((part) => (site ? part.includes(site) || site.includes(part) : false)) ||
      (tail.length === 1 && tail[0].length <= 24 && !/\s/.test(tail[0]));
    if (parts.length > 1 && looksLikeChrome) title = parts[0];
  }
  for (const separator of [" | ", " - ", " — ", "－"]) {
    const index = title.lastIndexOf(separator);
    if (index <= 0) continue;
    const tail = title.slice(index + separator.length).trim();
    if (site && (tail.includes(site) || site.includes(tail))) title = title.slice(0, index).trim();
  }
  return title.slice(0, MAX_TITLE).trim();
}

function collectParagraphs(block: string): string[] {
  const byClass = [...block.matchAll(/<div class="paragraph"[^>]*>([\s\S]*?)<\/div>/gi)].map(
    (match) => decodeEntities(match[1]),
  );
  if (byClass.length) return byClass;
  const byTag = [...block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) =>
    decodeEntities(match[1]),
  );
  if (byTag.length) return byTag;
  return [decodeEntities(block)];
}

/** Article paragraphs, best-effort. Empty when the page has no recognisable article body. */
export function extractLinkImportParagraphs(html: string): string[] {
  const candidates: string[] = [];
  const oncc = /<div class="breakingNewsContent"[^>]*>([\s\S]*?)<div class="imageList"/i.exec(html);
  if (oncc) candidates.push(...collectParagraphs(oncc[1]));
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html);
  if (!candidates.length && article) candidates.push(...collectParagraphs(article[1]));
  if (!candidates.length) {
    const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
    candidates.push(...collectParagraphs(body));
  }
  const seen = new Set<string>();
  const paragraphs: string[] = [];
  let total = 0;
  for (const candidate of candidates) {
    const text = candidate.replace(/\n{3,}/g, "\n\n").trim();
    if (text.length < 2 || seen.has(text)) continue;
    seen.add(text);
    if (total + text.length > MAX_BODY_CHARS) break;
    total += text.length;
    paragraphs.push(text);
    if (paragraphs.length >= MAX_PARAGRAPHS) break;
  }
  return paragraphs;
}

export function extractLinkImport(html: string, sourceUrl: string): LinkImportSource {
  const siteName = metaContent(html, "og:site_name");
  const title =
    cleanLinkImportTitle(metaContent(html, "og:title") ?? "", siteName) ||
    cleanLinkImportTitle(titleTag(html) ?? "", siteName);
  const imageUrl = metaContent(html, "og:image");
  return {
    url: sourceUrl,
    title,
    excerpt: (metaContent(html, "og:description") ?? metaContent(html, "description") ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_EXCERPT),
    imageUrl: imageUrl && isSafeArticleUrl(imageUrl) && !imageUrl.startsWith("#") ? imageUrl : null,
    siteName,
    paragraphs: extractLinkImportParagraphs(html),
  };
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Readable, collision-resistant slug: `<site>-<yyyymmdd>-<hash>`. The date comes from the
 * URL when it contains one (news URLs usually do), else from the import date. `nonce` lets
 * the server create a distinct draft when the same link is imported twice.
 */
export function linkImportSlug(url: string, title: string, nonce = ""): string {
  let host = "link";
  let urlDate = "";
  try {
    const parsed = new URL(url);
    host = parsed.hostname.replace(/^www\./i, "");
    urlDate = /(20\d{2})(\d{2})(\d{2})/.exec(parsed.pathname)?.[0] ?? "";
  } catch {
    /* isAllowedImportUrl already rejected it; keep a safe fallback */
  }
  const site =
    host
      .split(".")
      .slice(-2)
      .join("")
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase()
      .slice(0, 12) || "link";
  const date = urlDate || new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const hash = fnv1a(`${url}|${title}`).toString(16).padStart(8, "0").slice(0, 6);
  const suffix = nonce
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase()
    .slice(0, 6);
  return `${site}-${date}-${hash}${suffix ? `-${suffix}` : ""}`
    .toLowerCase()
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 240);
}

export function linkImportReadingMinutes(text: string): number {
  return Math.min(10_000, Math.max(1, Math.ceil(text.replace(/\s+/g, "").length / 400)));
}

/**
 * The draft the editor opens with. `published: false` and `publishedAt: null` keep it a
 * draft; publishing stays a separate, explicit staff action.
 */
export function buildLinkImportInput(
  source: LinkImportSource,
  options: { categoryId: string; slug: string },
): ArticleInput {
  const text = source.paragraphs.join("\n\n");
  const siteLabel = source.siteName ?? new URL(source.url).hostname;
  return {
    slug: options.slug,
    title: source.title || "未命名文章",
    excerpt: source.excerpt || null,
    categoryId: options.categoryId,
    published: false,
    publishedAt: null,
    coverImage: source.imageUrl,
    coverAlt: source.title ? source.title.slice(0, MAX_TITLE) : null,
    body: { format: "legacy-text", text },
    links: [{ href: source.url, label: `原文：${siteLabel}`.slice(0, 200) }],
    editorial: {
      author: null,
      reviewer: null,
      sourcesNote: `原文連結：${source.url}`,
      answerSummary: null,
      compareEstateSlugs: [],
    },
    readingMinutes: linkImportReadingMinutes(text),
    seoTitle: null,
    seoDescription: null,
  };
}
