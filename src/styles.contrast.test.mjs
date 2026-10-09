import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const css = readFileSync(new URL("src/styles.css", root), "utf8");

// Light-theme tokens: every top-level `:root { ... }` block, in file order.
const tokens = new Map();
for (const block of css.matchAll(/^:root\s*\{([\s\S]*?)^\}/gm)) {
  for (const decl of block[1]
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    tokens.set(decl[1], decl[2].trim());
  }
}

function resolve(name) {
  let value = tokens.get(name);
  assert.ok(value, `${name} is not defined in a :root block of styles.css`);
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  return ref ? resolve(ref[1]) : value;
}

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toLinearRgb(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return [0, 2, 4].map((i) => lin(parseInt(hex[1].slice(i, i + 2), 16) / 255));
  }
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

const color = (name) => toLinearRgb(resolve(name));
// Alpha compositing happens on gamma-encoded sRGB, as browsers do.
function over(fg, alpha, bg) {
  return fg.map((f, i) => lin(gamma(f) * alpha + gamma(bg[i]) * (1 - alpha)));
}
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("every audited text pair meets 4.5:1 and every UI pair 3:1", () => {
  const card = color("--card");
  const surface = color("--surface");
  const white = [1, 1, 1];
  const pairs = [];
  const add = (label, fg, bg, min) => pairs.push({ label, fg, bg, min });

  for (const [where, base] of [
    ["card", card],
    ["surface", surface],
  ]) {
    add(`destructive on ${where}`, color("--destructive"), base, 4.5);
    add(
      `destructive on destructive/10 over ${where}`,
      color("--destructive"),
      over(color("--destructive"), 0.1, base),
      4.5,
    );
    add(`primary on ${where}`, color("--primary"), base, 4.5);
    add(`muted-foreground on ${where}`, color("--muted-foreground"), base, 4.5);
    add(
      `primary on primary/10 over ${where} (icons, 3:1)`,
      color("--primary"),
      over(color("--primary"), 0.1, base),
      3,
    );
  }
  add("white on destructive", white, color("--destructive"), 4.5);
  add("white on whatsapp", white, color("--whatsapp"), 4.5);
  add("white on whatsapp-hover", white, color("--whatsapp-hover"), 4.5);
  add("whatsapp text on card", color("--whatsapp"), card, 4.5);
  add(
    "secondary-foreground on secondary",
    color("--secondary-foreground"),
    color("--secondary"),
    4.5,
  );
  add("muted-foreground on muted", color("--muted-foreground"), color("--muted"), 4.5);

  const failures = pairs
    .map((p) => ({ ...p, got: ratio(p.fg, p.bg) }))
    .filter((p) => p.got < p.min)
    .map((p) => `${p.label}: ${p.got.toFixed(2)} < ${p.min}`);
  assert.deepEqual(failures, []);
});

test("--brand-primary, --primary and SITE_THEME_COLOR are unchanged", () => {
  assert.equal(tokens.get("--brand-primary"), "oklch(0.515 0.11 156.8)");
  assert.equal(tokens.get("--primary"), "var(--brand-primary)");
  const seo = readFileSync(new URL("src/content/seo.ts", root), "utf8");
  assert.match(seo, /SITE_THEME_COLOR = "#1F7A4D"/);
});

test("the whatsapp tokens are exposed as Tailwind colours", () => {
  assert.match(css, /--color-whatsapp:\s*var\(--whatsapp\);/);
  assert.match(css, /--color-whatsapp-hover:\s*var\(--whatsapp-hover\);/);
});

test("no source file hard-codes #25D366, #1ebe57 or #08783f", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx$/.test(name) && /#25d366|#1ebe57|#08783f/i.test(readFileSync(path, "utf8"))) {
        offenders.push(path);
      }
    }
  };
  walk(new URL("src", root).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  assert.deepEqual(offenders, []);
});
