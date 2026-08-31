import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("district.sham-tseng.tsx no longer hardcodes a named school list", () => {
  const source = readFileSync("src/routes/district.sham-tseng.tsx", "utf8");
  assert.doesNotMatch(source, /const SCHOOLS = \[/);
  assert.doesNotMatch(source, /深井天主教小學/);
  assert.match(source, /import \{ schoolNets \} from "@\/content\/school-nets"/);
  assert.match(source, /<DataNote/);
});

test("district.sham-tseng.tsx uses DataNote for transit, header stats, transactions, and school-net (4 total)", () => {
  const source = readFileSync("src/routes/district.sham-tseng.tsx", "utf8");
  const usages = source.match(/<DataNote\b/g) ?? [];
  // school-net (pre-existing) + transit + header stat tiles + transaction
  // source paragraph, extended by this task from 1 to 4.
  assert.equal(usages.length, 4);
});

test("district.sham-tseng.tsx transit DataNote is honest about not having a verified as-of date", () => {
  const source = readFileSync("src/routes/district.sham-tseng.tsx", "utf8");
  // The transit list is static curated copy with no real verification date --
  // the caveat must say so honestly, not assert a fabricated confirmation.
  assert.match(source, /交通時間為一般估算/);
  assert.doesNotMatch(source, /交通時間已於.*(核實|確認)/);
  assert.doesNotMatch(source, /已於\s*\d{4}\s*年.*(核實|確認)交通/);
});

test("district.sham-tseng.tsx header-stat DataNote does not claim a fixed verification date", () => {
  const source = readFileSync("src/routes/district.sham-tseng.tsx", "utf8");
  assert.match(source, /本行屋苑資料庫及成交記錄/);
  assert.doesNotMatch(source, /本行屋苑資料庫及成交記錄.*已於\s*\d{4}\s*年/);
});

test("district.sham-tseng.tsx transaction-source paragraph is a DataNote, not a bare <p>", () => {
  const source = readFileSync("src/routes/district.sham-tseng.tsx", "utf8");
  assert.doesNotMatch(
    source,
    /<p className="mt-1 text-sm text-muted-foreground">\s*資料來源：本行成交記錄/,
  );
  assert.match(
    source,
    /<DataNote\s+className="mt-1"\s+source=\{`本行成交記錄（\$\{transactions\.length\} 宗買賣）`\}\s*\/>/,
  );
});

test("school-nets.ts ships no named school without a source", () => {
  // Read as source text rather than imported, matching the pattern already
  // used elsewhere in this repo for .ts content modules consumed from
  // node --test .mjs files (see castle-peak-road.test.mjs's `read()`
  // helper) -- this file has no non-type imports, so a plain source-text
  // check is sufficient and avoids adding a build step to this test.
  const source = readFileSync("src/content/school-nets.ts", "utf8");
  assert.match(source, /primarySchools: \[\]/);
});
