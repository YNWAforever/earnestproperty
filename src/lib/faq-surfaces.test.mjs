import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROUTES_DIR = "src/routes";
const COMPONENTS_DIR = "src/components";

function allSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allSourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

// Coarse source-scan: it only proves the import/usage co-occurs in the same
// file, not that renderableFaqs() actually guards the exact array that feeds
// the JSON-LD below. That's an intentional, honest limitation -- no render
// harness exists for most of these routes. It still catches the real failure
// mode this test exists for: a future sixth FAQ-JSON-LD surface added without
// ever importing renderableFaqs (src/lib/faq.ts) at all.
test("every file emitting FAQPage JSON-LD also references renderableFaqs", () => {
  for (const file of [...allSourceFiles(ROUTES_DIR), ...allSourceFiles(COMPONENTS_DIR)]) {
    const source = readFileSync(file, "utf8");
    if (!source.includes('"@type": "FAQPage"')) continue;
    assert.match(
      source,
      /renderableFaqs/,
      `${file} emits FAQPage JSON-LD but does not appear to use renderableFaqs`,
    );
  }
});
