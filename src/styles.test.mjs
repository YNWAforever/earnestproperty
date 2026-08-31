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

// P7c: fonts are self-hosted via @fontsource (no Google Fonts CDN request at
// all) instead of a preloaded external stylesheet -- this replaces the old
// "preloads the Google Fonts stylesheet" assertion, which stopped describing
// real behavior once that migration landed.
test("__root.tsx self-hosts fonts via @fontsource and preloads the real Inter woff2 file", () => {
  const source = read("src/routes/__root.tsx");
  assert.match(source, /import "@fontsource\/inter\/400\.css";/);
  assert.match(source, /import "@fontsource\/noto-sans-tc\/400\.css";/);
  assert.match(
    source,
    /import interLatin400 from "@fontsource\/inter\/files\/inter-latin-400-normal\.woff2\?url";/,
  );
  assert.match(
    source,
    /rel:\s*"preload",\s*\n\s*as:\s*"font",\s*\n\s*type:\s*"font\/woff2",\s*\n\s*href:\s*interLatin400,/,
  );
  assert.doesNotMatch(source, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
});

test("the homepage hero headline uses text-balance and a non-breaking brand span, not a hard <br>", () => {
  const source = read("src/routes/index.tsx");
  // index.tsx also has an unrelated errorComponent <h1>("載入失敗") earlier in the
  // file, so a plain (non-global) match would grab that one instead of the hero.
  // Find every <h1>...</h1> block and select the one that actually contains the
  // hero's brand name.
  const headingMatches = source.match(/<h1[^>]*>[\s\S]*?<\/h1>/g) || [];
  const heading = headingMatches.find((block) => block.includes("晉誠地產"));
  assert.ok(heading, "expected to find the hero <h1> in index.tsx");
  assert.match(heading, /text-balance/, "hero <h1> should use the text-balance utility");
  assert.doesNotMatch(heading, /<br\s*\/?>/, "hero <h1> should not force a line break");
  assert.match(
    heading,
    /whitespace-nowrap[^>]*>晉誠地產/,
    "晉誠地產 should not be allowed to break mid-word",
  );
});
