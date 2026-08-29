import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("styles.css defines the three P1 additive tokens with their computed oklch values", () => {
  const source = read("src/styles.css");
  assert.match(source, /--surface-warm:\s*oklch\(0\.975 0\.009 78\.3\);/);
  assert.match(source, /--ink-charcoal:\s*oklch\(0\.272 0\.009 67\.4\);/);
  assert.match(source, /--brand-accent-bronze:\s*oklch\(0\.456 0\.087 59\.5\);/);
});

test("styles.css exposes the three new tokens as Tailwind color utilities", () => {
  const source = read("src/styles.css");
  assert.match(source, /--color-surface-warm:\s*var\(--surface-warm\);/);
  assert.match(source, /--color-ink-charcoal:\s*var\(--ink-charcoal\);/);
  assert.match(source, /--color-brand-accent-bronze:\s*var\(--brand-accent-bronze\);/);
});

test("styles.css still keeps --coral as a working alias (not retired in P1 -- see this plan's header)", () => {
  const source = read("src/styles.css");
  assert.match(source, /--coral:\s*var\(--brand-primary\);/);
});

test("__root.tsx preloads the Google Fonts stylesheet ahead of the blocking stylesheet link", () => {
  const source = read("src/routes/__root.tsx");
  assert.match(
    source,
    /rel:\s*"preload",\s*\n\s*as:\s*"style",\s*\n\s*href:\s*"https:\/\/fonts\.googleapis\.com\/css2\?family=Inter/,
  );
});
