import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// FX-20 (design-system polish): source-level checks on the tokens, base rules and primitive
// class strings. The browser-level checks live in e2e/design-states.spec.ts.

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const css = read("src/styles.css");

// Light-theme tokens: every top-level `:root { ... }` block, in file order
// (same reader as styles.contrast.test.mjs).
const tokens = new Map();
for (const block of css.matchAll(/^:root\s*\{([\s\S]*?)^\}/gm)) {
  for (const decl of block[1]
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    tokens.set(decl[1], decl[2].trim());
  }
}

function resolveToken(name) {
  const value = tokens.get(name);
  assert.ok(value, `${name} is not defined in a :root block of styles.css`);
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  return ref ? resolveToken(ref[1]) : value;
}

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function toLinearRgb(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => lin(parseInt(hex[1].slice(i, i + 2), 16) / 255));
  const ok = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  assert.ok(ok, `unsupported colour ${value}`);
  const [L, C, H] = [Number(ok[1]), Number(ok[2]), (Number(ok[3]) * Math.PI) / 180];
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => Math.min(1, Math.max(0, c)));
}

const color = (name) => toLinearRgb(resolveToken(name));
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function sourceFiles(dir, pattern) {
  const out = [];
  const walk = (path) => {
    for (const name of readdirSync(path)) {
      const child = join(path, name);
      if (statSync(child).isDirectory()) walk(child);
      else if (pattern.test(name)) out.push(child.replace(/\\/g, "/"));
    }
  };
  walk(new URL(dir, root).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  return out;
}
const relative = (path) => path.slice(path.lastIndexOf("/src/") + 1);

// ---------------------------------------------------------------------------
// Task 1: tokens and base rules (C1, C2 base rule, C5, C12)
// ---------------------------------------------------------------------------

test("headings have no negative letter-spacing", () => {
  const rule = css.match(/h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*\{([^}]*)\}/);
  assert.ok(rule, "the h1…h6 base rule exists");
  assert.doesNotMatch(rule[1], /letter-spacing:\s*-/);
  const spacing = rule[1].match(/letter-spacing:\s*([^;]+);/);
  if (spacing) assert.equal(spacing[1].trim(), "normal");
});

test("--input meets 3:1 on card and on surface", () => {
  assert.equal(tokens.get("--input"), "oklch(0.64 0.017 157)");
  assert.ok(ratio(color("--input"), color("--card")) >= 3, "--input on --card");
  assert.ok(ratio(color("--input"), color("--surface")) >= 3, "--input on --surface");
});

test("only form fields use border-input", () => {
  const allowed = new Set([
    "src/components/ui/input.tsx",
    "src/components/ui/textarea.tsx",
    "src/components/ui/select.tsx",
  ]);
  const offenders = sourceFiles("src/", /\.tsx$/)
    .filter((file) => /\b(?:border|bg|ring|outline)-input\b/.test(readFileSync(file, "utf8")))
    .map(relative)
    .filter((file) => !allowed.has(file));
  assert.deepEqual(offenders, []);
  assert.match(
    read("src/components/ui/button.tsx"),
    /outline:\s*\n?\s*"border border-border bg-background/,
  );
  // The neon-auth layer (@neondatabase/neon-js/ui/tailwind) is declared after Tailwind's layers,
  // so its `* { border-color }` beats any plain border-colour utility: fields mark theirs !important.
  for (const field of allowed) assert.match(read(field), /\bborder border-input! /, field);
});

test("a global focus-visible fallback uses --ring with a 2 px outline and 2 px offset", () => {
  const rule = css.match(
    /:where\(a, button, summary, \[role="button"\], \[tabindex\]:not\(\[tabindex="-1"\]\)\):focus-visible\s*\{([^}]*)\}/,
  );
  assert.ok(rule, "the :where(...):focus-visible base rule exists");
  assert.match(rule[1], /outline:\s*2px solid var\(--ring\);/);
  // !important: the neon-auth layer sets every outline-color to --ring at 50%.
  assert.match(rule[1], /outline-color:\s*var\(--ring\) !important;/);
  assert.match(rule[1], /outline-offset:\s*2px;/);
});

test("the footer sets its ring to --brand-bright, which is 3:1 on the footer", () => {
  assert.match(read("src/components/site/SiteFooter.tsx"), /\[--ring:var\(--brand-bright\)\]/);
  assert.ok(ratio(color("--brand-bright"), color("--foreground")) >= 3);
  // The default ring would not be: this is why the footer overrides it.
  assert.ok(ratio(color("--ring"), color("--foreground")) < 3);
});

test("no --chart- token remains", () => {
  assert.doesNotMatch(css, /--(?:color-)?chart-/);
  const offenders = sourceFiles("src/", /\.(tsx|ts|css)$/)
    .filter((file) => /\bchart-[1-5]\b/.test(readFileSync(file, "utf8")))
    .map(relative);
  assert.deepEqual(offenders, []);
});

test("--primary, --brand-primary, --border, --destructive and SITE_THEME_COLOR are unchanged", () => {
  assert.equal(tokens.get("--brand-primary"), "oklch(0.515 0.11 156.8)");
  assert.equal(tokens.get("--primary"), "var(--brand-primary)");
  assert.equal(tokens.get("--border"), "oklch(0.912 0.017 157)");
  assert.equal(tokens.get("--destructive"), "oklch(0.53 0.21 27)");
  assert.equal(tokens.get("--ring"), "var(--brand-primary)");
  assert.match(read("src/content/seo.ts"), /SITE_THEME_COLOR = "#1F7A4D"/);
});
