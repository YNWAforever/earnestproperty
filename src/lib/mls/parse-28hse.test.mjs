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
