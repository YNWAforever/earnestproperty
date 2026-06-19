import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  buildPagedUrl,
  extractDetailUrls,
  extractMaxPage,
} from "../discover.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, "../__fixtures__/property-index-page.html"), "utf8");

test("extractDetailUrls returns absolute unique old detail URLs", () => {
  assert.deepEqual(extractDetailUrls(html, "https://www.earnestproperty.com/property/"), [
    "https://www.earnestproperty.com/property-detail/6707256.html",
    "https://www.earnestproperty.com/property-detail/6707264.html",
  ]);
});

test("extractMaxPage reads pagination JavaScript page numbers", () => {
  assert.equal(extractMaxPage(html), 119);
});

test("buildPagedUrl preserves old directory paths", () => {
  assert.equal(
    buildPagedUrl("https://www.earnestproperty.com/property/c5/", 3),
    "https://www.earnestproperty.com/property/c5/?page=3",
  );
});
