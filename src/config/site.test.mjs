import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const files = [
  "src/components/site/SiteHeader.tsx",
  "src/components/site/SiteFooter.tsx",
  "src/routes/contact.tsx",
  "src/routes/index.tsx",
  "src/routes/estate.$slug.tsx",
];

test("public source files do not contain placeholder contact values", () => {
  const combined = files.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.equal(combined.includes("852XXXXXXXX"), false);
  assert.equal(combined.includes("+852 0000 0000"), false);
  assert.equal(combined.includes("tel:+85200000000"), false);
});

test("site config exposes segmented whatsapp intent helpers", () => {
  const source = readFileSync("src/config/site.ts", "utf8");

  assert.match(source, /export type WhatsAppIntent = "buy" \| "rent" \| "valuation"/);
  assert.match(source, /export function whatsappIntentMessage/);
  assert.match(source, /export function whatsappIntentUrl/);
  assert.match(source, /我要買樓/);
  assert.match(source, /我要租樓/);
  assert.match(source, /我要放盤估價/);
  assert.match(source, /深井業主估價報告/);
});

test("source files avoid the older disallowed listing wording", () => {
  const forbidden = String.fromCharCode(30495, 30436, 28304);
  const files = [
    "src/config/site.ts",
    "src/content/seo.ts",
    "src/routes/index.tsx",
    "src/routes/listings.tsx",
    "src/routes/estate.$slug.tsx",
    "src/components/site/SiteHeader.tsx",
    "src/components/site/SiteFooter.tsx",
  ];
  const combined = files.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.equal(combined.includes(forbidden), false);
});
