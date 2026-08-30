import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// /privacy, /disclaimer, and /terms currently ship reasonable placeholder
// copy, not a Hong Kong PDPO/legal-professional-reviewed final text. This
// suite guards two things that must never regress silently:
//   1. the TODO(client/legal) marker that flags the copy as unreviewed --
//      someone could otherwise delete it and start treating the placeholder
//      text as final without sign-off.
//   2. an explicit 生效日期 (effective date) / 最後更新日期 (last-updated
//      date) field near the top of each page, so a future update to the
//      copy has somewhere to record when it actually changed.
// See docs/superpowers/plans/2026-08-30-frontend-revamp-p5-transactions-agents-forms.md,
// Task 9, for why this task deliberately does not touch the substantive
// legal copy itself.

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

const LEGAL_ROUTES = [
  "src/routes/privacy.tsx",
  "src/routes/disclaimer.tsx",
  "src/routes/terms.tsx",
];

for (const routePath of LEGAL_ROUTES) {
  test(`${routePath} keeps its TODO(client/legal) sign-off marker`, () => {
    const source = read(routePath);
    assert.match(
      source,
      /TODO\(client\/legal\)/,
      `${routePath} must keep a TODO(client/legal) marker until a licensed HK legal/privacy professional reviews the copy`,
    );
  });

  test(`${routePath} renders an effective-date / last-updated-date field`, () => {
    const source = read(routePath);
    assert.match(
      source,
      /生效日期/,
      `${routePath} must render an explicit 生效日期 (effective date) field near the top of the page`,
    );
    assert.match(
      source,
      /最後更新日期/,
      `${routePath} must render an explicit 最後更新日期 (last-updated date) field near the top of the page`,
    );
  });

  test(`${routePath} does not hardcode a real-looking effective/last-updated date`, () => {
    const source = read(routePath);
    // The date fields must stay a placeholder (e.g. "[待補]") until legal
    // sign-off supplies a real date -- this guards against someone "helpfully"
    // filling in today's date as if it were an authoritative effective date.
    assert.doesNotMatch(
      source,
      /(生效日期|最後更新日期)[^\n]{0,20}\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/,
      `${routePath}'s date fields must stay placeholders, not a fabricated real date`,
    );
  });
}
