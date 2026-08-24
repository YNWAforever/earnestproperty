import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  build28HseAgentUrl,
  detect28HseChallenge,
  parse28HseAgentIndex,
  parse28HseDetail,
} from "./parse-28hse.mjs";

const fixture = (name) =>
  readFileSync(new URL("./__fixtures__/28hse/" + name, import.meta.url), "utf8");

test("builds deal-specific page URLs instead of following rel=next", () => {
  assert.equal(
    build28HseAgentUrl("rent", 2),
    "https://www.28hse.com/agent/540?buyRent=rent&page=2&plan_id=540&propertyDoSearchVersion=2.0",
  );
});

test("extracts exact agent identity, advertised count, and unique links", () => {
  const page = parse28HseAgentIndex(fixture("agent-sale-page-1.html"), {
    dealType: "sale",
    pageUrl: build28HseAgentUrl("sale", 1),
  });
  assert.equal(page.companyLicence, "C-018613");
  assert.match(page.companyName, /晉誠地產|Earnest Property/i);
  assert.equal(page.dealType, "sale");
  assert.equal(page.links.length, 2);
  assert.ok(page.advertisedCount >= page.links.length);
});

test("parses semantic agent identity, deal count, strict links, and longest duplicate title", () => {
  const sale = parse28HseAgentIndex(fixture("agent-sale-page-1.html"), {
    dealType: "sale",
    pageUrl: build28HseAgentUrl("sale", 1),
  });
  const rent = parse28HseAgentIndex(fixture("agent-rent-page-1.html"), {
    dealType: "rent",
    pageUrl: build28HseAgentUrl("rent", 1),
  });

  assert.equal(sale.companyName, "晉誠地產 Earnest Property");
  assert.equal(sale.companyLicence, "C-018613");
  assert.equal(sale.advertisedCount, 3);
  assert.deepEqual(
    sale.links.map(({ externalId }) => externalId),
    ["3972991", "3973002"],
  );
  assert.equal(
    sale.links.find(({ externalId }) => externalId === "3972991")?.summaryTitle,
    "較完整樓盤標題",
  );
  assert.deepEqual(
    rent.links.map(({ externalId }) => externalId),
    ["3976155"],
  );
  assert.equal(rent.advertisedCount, 1);
});

test("rejects malformed semantic identity, count, and contradictory listing links", () => {
  const context = {
    dealType: "sale",
    pageUrl: build28HseAgentUrl("sale", 1),
  };
  const invalidPages = [
    "<h1>晉誠地產</h1><p>公司牌照: C-999999</p><p>共有 1 個放售樓盤</p><a href='/buy/apartment/property-1'>一號</a>",
    "<h1>晉誠地產</h1><p>C-018613 C-999999</p><p>共有 1 個放售樓盤</p><a href='/buy/apartment/property-1'>一號</a>",
    "<h1>晉誠地產</h1><h1>另一公司</h1><p>C-018613</p><p>共有 1 個放售樓盤</p><a href='/buy/apartment/property-1'>一號</a>",
    "<h1>晉誠地產</h1><p>C-018613</p><a href='/buy/apartment/property-1'>一號</a>",
    "<h1>晉誠地產</h1><p>C-018613</p><p>共有 1 個放售樓盤</p>",
    "<h1>晉誠地產</h1><p>C-018613</p><p>共有 2 個放售樓盤</p><a href='/buy/apartment/property-1'>一號</a><a href='/buy/house/property-1'>另一個一號</a>",
    "<h1>晉誠地產</h1><p>C-018613</p><p>共有 1 個放售樓盤</p><a href='/buy/a/b/property-9'>過深路徑</a>",
  ];

  for (const html of invalidPages) {
    assert.throws(
      () => parse28HseAgentIndex(html, context),
      /template|licence|company|count/i,
    );
  }
  for (const name of [
    "agent-sale-count-mismatch.html",
    "agent-sale-conflicting-counts.html",
  ]) {
    assert.throws(
      () => parse28HseAgentIndex(fixture(name), context),
      /count|template/i,
    );
  }
});

test("rejects unsafe agent index URLs at the exact trust boundary", () => {
  const validHtml = fixture("agent-sale-page-1.html");
  const unsafeUrls = [
    "http://www.28hse.com/agent/540?buyRent=buy&page=1&plan_id=540&propertyDoSearchVersion=2.0",
    "https://user:pass@www.28hse.com/agent/540?buyRent=buy&page=1&plan_id=540&propertyDoSearchVersion=2.0",
    "https://www.28hse.com:444/agent/540?buyRent=buy&page=1&plan_id=540&propertyDoSearchVersion=2.0",
    "https://www.28hse.com:443/agent/540?buyRent=buy&page=1&plan_id=540&propertyDoSearchVersion=2.0",
    " https://www.28hse.com:443/agent/540?buyRent=buy&page=1&plan_id=540&propertyDoSearchVersion=2.0",
    "https://@www.28hse.com/agent/540?buyRent=buy&page=1&plan_id=540&propertyDoSearchVersion=2.0",
    "https://:@www.28hse.com/agent/540?buyRent=buy&page=1&plan_id=540&propertyDoSearchVersion=2.0",
    "https://28hse.com/agent/540?buyRent=buy&page=1&plan_id=540&propertyDoSearchVersion=2.0",
    "https://www.28hse.com/agent/541?buyRent=buy&page=1&plan_id=540&propertyDoSearchVersion=2.0",
    "https://www.28hse.com/agent/540?buyRent=buy&page=1&plan_id=541&propertyDoSearchVersion=2.0",
    "https://www.28hse.com/agent/540?buyRent=buy&page=1&plan_id=540&propertyDoSearchVersion=1.0",
    "https://www.28hse.com/agent/540?buyRent=buy&page=1&plan_id=540&propertyDoSearchVersion=2.0&extra=1",
    "https://www.28hse.com/agent/540?buyRent=buy&page=0&plan_id=540&propertyDoSearchVersion=2.0",
    "https://www.28hse.com/agent/540?buyRent=buy&page=101&plan_id=540&propertyDoSearchVersion=2.0",
    "https://www.28hse.com/agent/540?buyRent=buy&page=1.0&plan_id=540&propertyDoSearchVersion=2.0",
    "https://www.28hse.com/agent/540?buyRent=buy&page=1e0&plan_id=540&propertyDoSearchVersion=2.0",
    "https://www.28hse.com/agent/540?buyRent=buy&page=1&page=2&plan_id=540&propertyDoSearchVersion=2.0",
  ];

  for (const pageUrl of unsafeUrls) {
    assert.throws(() =>
      parse28HseAgentIndex(validHtml, {
        dealType: "sale",
        pageUrl,
      }),
    );
  }
});

test("rejects non-string agent URLs and embedded ASCII whitespace before URL parsing", () => {
  const validHtml = fixture("agent-sale-page-1.html");
  const validUrl = build28HseAgentUrl("sale", 1);
  const unsafeUrls = [
    new URL(validUrl),
    validUrl.replace("/540", "/5\n40"),
    validUrl.replace("buyRent=buy", "buyRent=b\tuy"),
    validUrl.replace("&page=1", "\n&page=1"),
  ];

  for (const pageUrl of unsafeUrls) {
    assert.throws(
      () =>
        parse28HseAgentIndex(validHtml, {
          dealType: "sale",
          pageUrl,
        }),
      /source URL/i,
    );
  }
});

test("deduplicates empty and image-only anchors before choosing the longest title", () => {
  const page = parse28HseAgentIndex(
    [
      "<h1>晉誠地產 Earnest Property</h1>",
      "<p>公司牌照: C-018613</p>",
      "<p>共有 1 個放售樓盤</p>",
      "<a href='/buy/apartment/property-3972991/'><img src='/listing.jpg' alt=''></a>",
      "<a href='/buy/apartment/property-3972991'>較短標題</a>",
      "<a href='/buy/apartment/property-3972991/'>較完整樓盤標題</a>",
    ].join(""),
    {
      dealType: "sale",
      pageUrl: build28HseAgentUrl("sale", 1),
    },
  );

  assert.deepEqual(page.links, [
    {
      externalId: "3972991",
      url: "https://www.28hse.com/buy/apartment/property-3972991",
      summaryTitle: "較完整樓盤標題",
    },
  ]);
});

test("rejects a listing ID only after all duplicate anchors lack a title", () => {
  const html = [
    "<h1>晉誠地產 Earnest Property</h1>",
    "<p>公司牌照: C-018613</p>",
    "<p>共有 1 個放售樓盤</p>",
    "<a href='/buy/apartment/property-3972991'><img src='/one.jpg' alt=''></a>",
    "<a href='/buy/apartment/property-3972991/' aria-label='listing'></a>",
  ].join("");

  assert.throws(
    () =>
      parse28HseAgentIndex(html, {
        dealType: "sale",
        pageUrl: build28HseAgentUrl("sale", 1),
      }),
    /title|template/i,
  );
});

test("rejects advertised counts outside the non-negative safe-integer range", () => {
  const html = [
    "<h1>晉誠地產 Earnest Property</h1>",
    "<p>公司牌照: C-018613</p>",
    "<p>共有 9007199254740992 個放售樓盤</p>",
    "<a href='/buy/apartment/property-3972991'>樓盤標題</a>",
  ].join("");

  assert.throws(
    () =>
      parse28HseAgentIndex(html, {
        dealType: "sale",
        pageUrl: build28HseAgentUrl("sale", 1),
      }),
    /count|template/i,
  );
});

test("detail parser allowlists listing facts and excludes platform modules", () => {
  const item = parse28HseDetail(fixture("detail-sale-3972991.html"), {
    sourceUrl: "https://www.28hse.com/buy/apartment/property-3972991",
    dealType: "sale",
    summaryTitle: "Earnest Property - 西半山單位",
    fetchedAt: "2026-08-17T02:00:00.000Z",
  });
  assert.equal(item.externalId, "3972991");
  assert.equal(item.propertyNoNormalized, "C003097");
  assert.equal(item.fields.title_zh, "Earnest Property - 西半山單位");
  assert.equal(item.fields.description, undefined);
  assert.equal(item.fields.view_count, undefined);
  assert.ok(item.mediaCandidates.every((candidate) => candidate.category === "listing_photo"));
  assert.ok(item.mediaCandidates.every((candidate) => !/map|floorplan|qr|vr/i.test(candidate.url)));
  assert.equal(item.mediaCandidates.length, 1);
});

test("challenge pages are detected before parsing", () => {
  assert.equal(detect28HseChallenge(fixture("challenge.html")), true);
  assert.throws(
    () =>
      parse28HseAgentIndex(fixture("challenge.html"), {
        dealType: "sale",
        pageUrl: build28HseAgentUrl("sale", 1),
      }),
    /challenge/i,
  );
});

test("does not classify a normal agent page as a challenge from nav/help text", () => {
  const html = fixture("agent-live-login-nav.html");
  assert.equal(detect28HseChallenge(html), false);
});

test("does not classify populated agent content from an unrelated sitekey", () => {
  const html = [
    "<title>晉誠地產 Earnest Property</title>",
    "<h1>晉誠地產 Earnest Property</h1>",
    "<p>公司牌照: C-018613</p>",
    "<p>共有 1 個放售樓盤</p>",
    "<a href='/buy/apartment/property-3972991'>樓盤標題</a>",
    "<aside data-sitekey='newsletter-widget'>訂閱市場資訊</aside>",
  ].join("");

  assert.equal(detect28HseChallenge(html), false);
});

test("detects punctuated challenge headings with a bounded vendor suffix", () => {
  for (const heading of [
    "Access Denied!",
    "Attention Required! | Cloudflare",
    "Verify you are human.",
  ]) {
    assert.equal(
      detect28HseChallenge(
        "<title>" + heading + "</title><h1>" + heading + "</h1>",
      ),
      true,
      heading,
    );
  }
});

test("detects canonical Cloudflare headings with terminal punctuation", () => {
  assert.equal(
    detect28HseChallenge(fixture("challenge-cloudflare-punctuated.html")),
    true,
  );
});

test("detects uppercase CAPTCHA iframe and form structure", () => {
  assert.equal(
    detect28HseChallenge(fixture("challenge-captcha-uppercase.html")),
    true,
  );
});

test("detects Cloudflare challenge shells before parsing", () => {
  const html = fixture("challenge-cloudflare.html");
  assert.equal(detect28HseChallenge(html), true);
  assert.throws(
    () =>
      parse28HseDetail(html, {
        sourceUrl: "https://www.28hse.com/buy/apartment/property-3972991",
        dealType: "sale",
        summaryTitle: "Earnest Property - Blocked",
        fetchedAt: "2026-08-17T02:00:00.000Z",
      }),
    /challenge/i,
  );
});

test("requires an exact HTTPS 28Hse detail URL for the active deal", () => {
  const context = {
    dealType: "rent",
    summaryTitle: "Earnest Property - Rental",
    fetchedAt: "2026-08-17T02:00:00.000Z",
  };
  for (const sourceUrl of [
    "http://www.28hse.com/rent/apartment/property-3976155",
    "https://www.28hse.com.evil.test/rent/apartment/property-3976155",
    "https://www.28hse.com/buy/apartment/property-3976155",
    "not a URL",
  ]) {
    assert.throws(
      () => parse28HseDetail(fixture("detail-rent-3976155.html"), { ...context, sourceUrl }),
      /source URL/i,
    );
  }
});

test("parses page-local sale and rent indexes and rejects impossible counts", () => {
  const sale = parse28HseAgentIndex(fixture("agent-sale-page-2.html"), {
    dealType: "sale",
    pageUrl: build28HseAgentUrl("sale", 2),
  });
  const rent = parse28HseAgentIndex(fixture("agent-rent-page-1.html"), {
    dealType: "rent",
    pageUrl: build28HseAgentUrl("rent", 1),
  });
  assert.deepEqual(
    sale.links.map((link) => link.externalId),
    ["3973002", "3973003"],
  );
  assert.match(sale.pageFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    rent.links.map((link) => link.externalId),
    ["3976155"],
  );
  assert.throws(
    () =>
      parse28HseAgentIndex(fixture("agent-sale-count-mismatch.html"), {
        dealType: "sale",
        pageUrl: build28HseAgentUrl("sale", 1),
      }),
    /count/i,
  );
  assert.throws(
    () =>
      parse28HseAgentIndex(fixture("agent-sale-conflicting-counts.html"), {
        dealType: "sale",
        pageUrl: build28HseAgentUrl("sale", 1),
      }),
    /count/i,
  );
});

test("missing optional values stay null while changed or malformed templates quarantine", () => {
  const optional = parse28HseDetail(fixture("detail-missing-optional.html"), {
    sourceUrl: "https://www.28hse.com/rent/apartment/property-3977001",
    dealType: "rent",
    summaryTitle: "Earnest Property - Rental",
    discoveredAt: "2026-08-17T01:59:00.000Z",
    fetchedAt: "2026-08-17T02:00:00.000Z",
  });
  assert.equal(optional.validationState, "valid");
  assert.equal(optional.fields.saleable_area ?? null, null);
  for (const name of ["detail-changed-layout.html", "empty.html", "malformed.html"]) {
    assert.throws(
      () =>
        parse28HseDetail(fixture(name), {
          sourceUrl: "https://www.28hse.com/buy/apartment/property-3977002",
          dealType: "sale",
          summaryTitle: "Earnest Property - Invalid fixture",
          discoveredAt: "2026-08-17T01:59:00.000Z",
          fetchedAt: "2026-08-17T02:00:00.000Z",
        }),
      /template|parse|empty/i,
    );
  }
  assert.equal(detect28HseChallenge(fixture("login.html")), true);
});
