import { describe, expect, test } from "bun:test";
import {
  buildLinkImportInput,
  cleanLinkImportTitle,
  extractLinkImport,
  extractLinkImportParagraphs,
  isAllowedImportUrl,
  linkImportReadingMinutes,
  linkImportSlug,
} from "./link-import";

// Trimmed copy of the on.cc article shape that prompted this feature: the article body is a
// `breakingNewsContent` block of `div.paragraph` nodes (no <p> tags), and the metadata lives
// in og:* tags whose title carries a "｜section｜site" suffix.
const ONCC_URL =
  "https://hk.on.cc/hk/bkn/cnt/finance/20260907/bkn-20260907181651372-0907_00842_001.html";
const ONCC_HTML = `<!doctype html><html><head>
<meta name="description" content="長情二手業主減價沽出持有近20年私宅。" />
<meta property="og:title" content="全海景套三房劈至每呎唔使8000元沽\u3000長情業主獲利幾多？" />
<meta property="og:type" content="article" />
<meta property="og:image" content="https://hk.on.cc/hk/bkn/cnt/finance/20260907/photo/bkn-20260907181651372-0907_00842_001_01b.jpg" />
<meta property="og:description" content="長情二手業主減價沽出持有近20年私宅，有三房全海景單位僅以每方呎低於8,000元賣出。" />
<meta property="og:site_name" content="on.cc東網" />
<title>全海景套三房劈至每呎唔使8000元沽\u3000長情業主獲利幾多？｜即時新聞｜產經｜on.cc東網</title>
</head><body>
<div class="news_content">
  <div class="breakingNewsContent">
    <div class="paragraph">長情二手業主減價沽出持有近20年私宅，有三房全海景單位僅以每方呎低於8,000元賣出。</div>
    <div class="paragraph">晉誠地產姚頌溏表示，青龍頭豪景花園19座高層D室，實用面積約947呎，套三房間隔。</div>
    <div class="paragraph">他指，有同區換樓客，議價20萬元，以748萬元承接，呎價約7,899元。</div>
  </div>
  <div class="imageList"></div>
</div>
</body></html>`;

describe("extractLinkImport", () => {
  test("reads og metadata and the on.cc paragraph blocks", () => {
    const source = extractLinkImport(ONCC_HTML, ONCC_URL);
    expect(source.url).toBe(ONCC_URL);
    expect(source.title).toBe("全海景套三房劈至每呎唔使8000元沽\u3000長情業主獲利幾多？");
    expect(source.siteName).toBe("on.cc東網");
    expect(source.excerpt).toContain("長情二手業主減價沽出");
    expect(source.imageUrl).toContain("bkn-20260907181651372");
    expect(source.paragraphs).toHaveLength(3);
    expect(source.paragraphs[1]).toContain("晉誠地產姚頌溏");
  });

  test("falls back to <p> tags and decodes entities", () => {
    const html = `<html><head><title>樓市 &amp; 成交｜Example</title></head><body>
      <article><p>第一段 &quot;成交&quot;。</p><p>第二段&#39;資料&#39;。</p></article></body></html>`;
    const source = extractLinkImport(html, "https://example.com/post");
    expect(source.paragraphs).toEqual(['第一段 "成交"。', "第二段'資料'。"]);
    expect(source.title).toBe("樓市 & 成交");
    expect(source.imageUrl).toBeNull();
    expect(source.siteName).toBeNull();
  });

  test("a page without a recognisable body yields no paragraphs", () => {
    expect(extractLinkImportParagraphs("<html><body><nav>選單</nav></body></html>")).toEqual([
      "選單",
    ]);
    expect(extractLinkImportParagraphs("<html><body></body></html>")).toEqual([]);
  });
});

describe("cleanLinkImportTitle", () => {
  test("strips the news-site title suffix", () => {
    expect(
      cleanLinkImportTitle(
        "全海景套三房劈至每呎唔使8000元沽\u3000長情業主獲利幾多？｜即時新聞｜產經｜on.cc東網",
        "on.cc東網",
      ),
    ).toBe("全海景套三房劈至每呎唔使8000元沽\u3000長情業主獲利幾多？");
  });
});

describe("isAllowedImportUrl", () => {
  test("accepts public https article URLs", () => {
    expect(isAllowedImportUrl(ONCC_URL)).toBe(true);
    expect(isAllowedImportUrl("https://example.com/a/b?c=1")).toBe(true);
  });

  test("rejects non-https, credentials and private hosts", () => {
    for (const url of [
      "http://example.com/post",
      "https://user:pass@example.com/post",
      "https://localhost/post",
      "https://app.localhost/post",
      "https://printer.local/post",
      "https://127.0.0.1/post",
      "https://10.0.0.5/post",
      "https://172.20.1.1/post",
      "https://192.168.1.10/post",
      "https://169.254.169.254/latest/meta-data",
      "https://100.64.0.1/post",
      "https://[::1]/post",
      "not a url",
    ])
      expect(isAllowedImportUrl(url), url).toBe(false);
  });
});

describe("linkImportSlug", () => {
  test("is a readable, URL-derived slug that passes the CMS slug pattern", () => {
    const slug = linkImportSlug(ONCC_URL, "全海景套三房");
    expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(slug).toContain("oncc");
    expect(slug).toContain("20260907");
    expect(slug.length).toBeLessThanOrEqual(240);
  });

  test("a nonce makes a second import of the same link distinct", () => {
    const first = linkImportSlug(ONCC_URL, "標題", "a1b2");
    const second = linkImportSlug(ONCC_URL, "標題", "c3d4");
    expect(first).not.toBe(second);
    expect(linkImportSlug(ONCC_URL, "標題")).toBe(linkImportSlug(ONCC_URL, "標題"));
  });
});

describe("buildLinkImportInput", () => {
  test("creates a draft that links back to the source", () => {
    const source = extractLinkImport(ONCC_HTML, ONCC_URL);
    const input = buildLinkImportInput(source, {
      categoryId: "category-1",
      slug: "oncc-20260907-ab12cd",
    });
    expect(input.published).toBe(false);
    expect(input.publishedAt).toBeNull();
    expect(input.categoryId).toBe("category-1");
    expect(input.slug).toBe("oncc-20260907-ab12cd");
    expect(input.title).toContain("全海景套三房");
    expect(input.coverImage).toContain("bkn-20260907181651372");
    expect(input.links).toEqual([{ href: ONCC_URL, label: "原文：on.cc東網" }]);
    expect(input.editorial.sourcesNote).toBe(`原文連結：${ONCC_URL}`);
    expect(input.body.format).toBe("legacy-text");
    if (input.body.format === "legacy-text") {
      expect(input.body.text.split("\n\n")).toHaveLength(3);
      expect(input.body.text).toContain("晉誠地產姚頌溏");
    }
    expect(input.readingMinutes).toBeGreaterThanOrEqual(1);
  });

  test("reading time stays inside the CMS bounds", () => {
    expect(linkImportReadingMinutes("")).toBe(1);
    expect(linkImportReadingMinutes("字".repeat(900))).toBe(3);
    expect(linkImportReadingMinutes("字".repeat(10_000_000))).toBe(10_000);
  });
});
