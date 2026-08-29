import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("district.sham-tseng.tsx no longer hardcodes a named school list", () => {
  const source = readFileSync("src/routes/district.sham-tseng.tsx", "utf8");
  assert.doesNotMatch(source, /const SCHOOLS = \[/);
  assert.doesNotMatch(source, /深井天主教小學/);
  assert.match(
    source,
    /import \{ shamTsengSchoolNet \} from "@\/content\/school-nets"/,
  );
  assert.match(source, /<DataNote/);
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
