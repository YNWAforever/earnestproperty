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
