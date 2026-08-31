import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./estate.$slug.tsx", import.meta.url), "utf8");

test("estate.$slug.tsx no longer hardcodes a 深井-only hero eyebrow", () => {
  assert.ok(
    !source.includes('"深井屋苑獨立 SEO 頁"'),
    "hero eyebrow must come from the registry entry, not a literal string",
  );
});

test("estate.$slug.tsx no longer hardcodes /district/sham-tseng as every estate's breadcrumb target", () => {
  const literalBreadcrumb = /item:\s*`\$\{SITE_URL\}\/district\/sham-tseng`/;
  assert.ok(
    !literalBreadcrumb.test(source),
    "breadcrumb href must come from the registry entry's districtHref",
  );
});

test("estate.$slug.tsx no longer hardcodes districtName as every estate's CTA context", () => {
  assert.ok(
    !source.includes('districtName: "深井 / 青山公路"'),
    "ctaContext.districtName must come from the registry entry's locationLabelZh",
  );
});

test("estate.$slug.tsx no longer gates school-net display on district_slug === sham-tseng", () => {
  assert.ok(
    !source.includes('estate.district_slug === "sham-tseng"'),
    "school-net visibility must come from whether the estate's registry entry resolves a real school net code, not a single hardcoded district",
  );
});

test("estate.$slug.tsx no longer imports the retired shamTsengSchoolNet constant", () => {
  assert.ok(
    !source.includes("shamTsengSchoolNet"),
    "must use getSchoolNet(code) from school-nets.ts instead",
  );
});
