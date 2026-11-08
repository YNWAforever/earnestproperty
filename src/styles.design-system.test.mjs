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
  // FX-20d: with the neon-auth layer below components and utilities, the plain class wins.
  for (const field of allowed) assert.match(read(field), /\bborder border-input /, field);
});

test("the neon-auth layer sits between base and components, so the site's border colours win", () => {
  // The first `@layer` naming a layer fixes its place. Without this statement before the imports,
  // @neondatabase/neon-js/ui/tailwind appends neon-auth after utilities, where its
  // `* { border-color; outline-color }` beats every border and outline colour utility.
  const statement = css.match(/^@layer\s+([\w\s,-]+);/m);
  assert.ok(statement, "styles.css declares the layer order");
  assert.deepEqual(
    statement[1].split(",").map((name) => name.trim()),
    ["properties", "theme", "base", "neon-auth", "components", "utilities"],
  );
  const tailwindImport = css.indexOf('@import "tailwindcss"');
  assert.ok(statement.index < tailwindImport, "the order statement comes before the imports");
  assert.ok(tailwindImport < css.indexOf('@import "@neondatabase/neon-js/ui/tailwind"'));
  // The layer name is the one the package really uses, and it still sets the * defaults.
  const neonTheme = readFileSync(
    new URL("node_modules/@neondatabase/neon-js/dist/ui/theme.css", root),
    "utf8",
  );
  assert.match(
    neonTheme,
    /@layer neon-auth\s*\{[\s\S]*?\*\s*\{[^}]*border-color:\s*var\(--neon-border\)/,
  );
  // No border or outline colour class needs !important to beat it any more.
  const important = sourceFiles("src/", /\.(tsx|ts)$/)
    .filter((file) => !/\.test\./.test(file))
    .filter((file) => /\b(?:border|outline)-[\w/-]+!(?=[\s"'`])/.test(readFileSync(file, "utf8")))
    .map(relative);
  assert.deepEqual(important, []);
});

test("a global focus-visible fallback uses --ring with a 2 px outline and 2 px offset", () => {
  const rule = css.match(
    /:where\(a, button, summary, \[role="button"\], \[tabindex\]:not\(\[tabindex="-1"\]\)\):focus-visible\s*\{([^}]*)\}/,
  );
  assert.ok(rule, "the :where(...):focus-visible base rule exists");
  assert.match(rule[1], /outline:\s*2px solid var\(--ring\);/);
  // !important: the neon-auth layer sits above base and sets every outline-color to --ring at 50%.
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

// ---------------------------------------------------------------------------
// Task 2: primitive states (C2, C3, C4, C7, C10, C11, C14)
// ---------------------------------------------------------------------------

const ui = (name) => read(`src/components/ui/${name}.tsx`);
const RING = "focus-visible:ring-2 focus-visible:ring-ring";
const OFFSET = "focus-visible:ring-offset-2 focus-visible:ring-offset-background";

test("every primitive focus style is a 2 px ring with a 2 px background offset", () => {
  for (const name of [
    "button",
    "input",
    "textarea",
    "checkbox",
    "radio-group",
    "slider",
    "switch",
    "tabs",
  ]) {
    const source = ui(name);
    assert.ok(source.includes(RING), `${name}: ${RING}`);
    assert.ok(source.includes(OFFSET), `${name}: ${OFFSET}`);
    assert.doesNotMatch(source, /focus-visible:ring-1\b/, name);
  }
  // Radix opens the select on pointer down and the ring marks the open trigger (shadcn's choice).
  assert.match(
    ui("select"),
    /focus:ring-2 focus:ring-ring focus:ring-offset-2 ring-offset-background|ring-offset-background[^"]*focus:ring-2 focus:ring-ring focus:ring-offset-2/,
  );
  for (const name of ["badge", "dialog", "sheet"]) {
    const source = ui(name);
    assert.doesNotMatch(
      source,
      /(^|\s|")focus:(outline|ring)/,
      `${name} uses focus: not focus-visible:`,
    );
    assert.match(
      source,
      /focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2/,
    );
  }
  // No unprefixed ring offset: with shadow-sm it would draw a 2 px halo at rest.
  for (const name of ["button", "input", "textarea"]) {
    assert.doesNotMatch(ui(name), /(^|\s|")ring-offset-2\b/, name);
  }
});

test("Button has a pressed state and keeps busy buttons readable", () => {
  const button = ui("button");
  for (const token of [
    // Tailwind v4 scale-* sets the `scale` property, not `transform`, so both are listed.
    "transition-[color,background-color,border-color,box-shadow,transform,scale]",
    "duration-150",
    "motion-safe:active:scale-98",
    "aria-busy:cursor-progress",
    "aria-busy:disabled:opacity-100",
    "disabled:opacity-50",
  ]) {
    assert.ok(button.includes(token), token);
  }
  assert.doesNotMatch(button, /\btransition-colors\b/);
});

test("Badge has no hover style and the dialog close reads 「關閉」", () => {
  assert.doesNotMatch(ui("badge"), /hover:/);
  const dialog = ui("dialog");
  assert.match(dialog, /<span className="sr-only">關閉<\/span>/);
  assert.doesNotMatch(dialog, /sr-only">Close</);
});

test("the dialog and sheet close buttons are fully opaque while keyboard-focused", () => {
  // At opacity-70 their ring falls under 3:1 against the dialog background.
  for (const name of ["dialog", "sheet"]) assert.match(ui(name), /focus-visible:opacity-100/, name);
});

test("titles have no tracking-tight or leading-none", () => {
  for (const name of ["card", "dialog", "alert"]) {
    const source = ui(name);
    assert.doesNotMatch(source, /tracking-tight|leading-none/, name);
    assert.match(source, /leading-snug/, name);
  }
});

test("no transition-all in src", () => {
  const offenders = sourceFiles("src/", /\.tsx$/)
    .filter((file) => /\btransition-all\b/.test(readFileSync(file, "utf8")))
    .map(relative);
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------
// 20b Task 1: no text under 12 px (C6)
// ---------------------------------------------------------------------------

test("no text-[9px], text-[10px] or text-[11px] in src", () => {
  const offenders = sourceFiles("src/", /\.(tsx|ts)$/)
    .filter((file) => /\btext-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/.test(readFileSync(file, "utf8")))
    .map(relative);
  assert.deepEqual(offenders, []);
});

test("the estate photo credit is full-opacity text on a dark 50 % backing", () => {
  const grid = read("src/components/site/EstateGroupGrid.tsx");
  assert.match(grid, /rounded bg-foreground\/50 px-1 text-xs text-primary-foreground"/);
  assert.doesNotMatch(grid, /text-primary-foreground\/60/);
});

// ---------------------------------------------------------------------------
// 20b Task 2: one neutral family and named status colours in the admin (C8, C9)
// ---------------------------------------------------------------------------

// Outside the 17b/17c screens only: admin.whatsapp, admin.blasts, admin.segments,
// admin.property-sync and admin.leads (and AdminShell's nav array) keep theirs until then.
const STATUS_TOKEN_FILES = [
  "src/components/admin/AdminShell.tsx",
  "src/routes/admin.index.tsx",
  "src/components/admin/team/AdminTeamStatusBadge.tsx",
  "src/components/admin/operations/AdminOperationsJobs.tsx",
  "src/components/admin/AdminNoPermission.tsx",
  "src/components/admin/AdminPropertyWorkspace.tsx",
  "src/components/admin/AdminPropertyTable.tsx",
  "src/components/admin/AdminContentCopilot.tsx",
  "src/components/admin/analytics/PerformanceDashboard.tsx",
  "src/components/admin/whatsapp/WhatsappLinkWizard.tsx",
  "src/components/admin/whatsapp/WhatsappBatchResult.tsx",
  "src/components/admin/TransactionAttributionEditor.tsx",
  "src/components/admin/AdminPropertyBulkActions.tsx",
];

test("the listed admin files use no slate-, amber- or emerald- class", () => {
  const offenders = STATUS_TOKEN_FILES.flatMap((file) =>
    [...read(file).matchAll(/\b(?:slate|amber|emerald)-\d+\b/g)].map((m) => `${file}: ${m[0]}`),
  );
  assert.deepEqual(offenders, []);
});

test("the warning and success tokens equal the Tailwind values they replace", () => {
  const pinned = {
    "--warning": "#fffbeb", // amber-50
    "--warning-subtle": "#fef3c7", // amber-100
    "--warning-border": "#fcd34d", // amber-300
    "--warning-strong": "#f59e0b", // amber-500
    "--warning-accent": "#b45309", // amber-700
    "--warning-foreground": "#451a03", // amber-950 (replaces amber-800/-900 text)
    "--success-subtle": "#ecfdf5", // emerald-50
    "--success": "#047857", // emerald-700
    "--success-foreground": "#065f46", // emerald-800
  };
  for (const [name, value] of Object.entries(pinned)) {
    assert.equal(tokens.get(name), value, name);
    assert.ok(
      css.includes(`--color${name.slice(1)}: var(${name});`),
      `${name} is a Tailwind colour`,
    );
  }
});

// Alpha-composite a token over a backdrop (linear-light approximation is fine for a floor check
// only when done in sRGB space, so convert back first).
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const over = (fg, alpha, bg) =>
  fg.map((c, i) => lin(alpha * toSrgb(c) + (1 - alpha) * toSrgb(bg[i])));

test("status text stays readable on its backgrounds", () => {
  const card = color("--card");
  const fg = color("--warning-foreground");
  assert.ok(ratio(fg, color("--warning")) >= 4.5, "warning-foreground on warning");
  assert.ok(ratio(fg, color("--warning-strong")) >= 4.5, "warning-foreground on warning-strong");
  assert.ok(ratio(fg, color("--warning-subtle")) >= 4.5, "warning-foreground on warning-subtle");
  assert.ok(
    ratio(fg, over(color("--warning-accent"), 0.1, card)) >= 4.5,
    "warning-foreground on warning-accent/10",
  );
  assert.ok(ratio(color("--warning-accent"), card) >= 4.5, "warning-accent text on card");
  const ok = color("--success-foreground");
  assert.ok(ratio(ok, over(color("--success"), 0.1, card)) >= 4.5, "success-foreground on /10");
  assert.ok(ratio(ok, color("--success-subtle")) >= 4.5, "success-foreground on success-subtle");
  // slate-700 → foreground/80, on bg-muted and on the muted-foreground/10 badge tint.
  const soft = over(color("--foreground"), 0.8, color("--muted"));
  assert.ok(ratio(soft, color("--muted")) >= 4.5, "foreground/80 on muted");
  const tint = over(color("--muted-foreground"), 0.1, card);
  assert.ok(ratio(over(color("--foreground"), 0.8, tint), tint) >= 4.5, "foreground/80 on tint");
});

test("the admin shell background and dashboard neutrals come from tokens", () => {
  assert.match(read("src/components/admin/AdminShell.tsx"), /"min-h-screen bg-background"/);
  const dashboard = read("src/routes/admin.index.tsx");
  assert.match(dashboard, /bg-muted px-3 py-2 transition hover:bg-accent/);
  assert.doesNotMatch(dashboard, /\bslate-/);
});

// ---------------------------------------------------------------------------
// 20b Task 3: one class for native selects (Open question 2)
// ---------------------------------------------------------------------------

// The 17b/17c screens (inbox, leads, blasts, segments, property-sync) keep their selects
// until those rebuilds land; everything else uses nativeFieldClassName.
const NATIVE_SELECT_EXEMPT = new Set([
  "src/components/admin/StaffNotificationPanel.tsx", // admin.whatsapp inbox
  "src/components/admin/WhatsappConsentDialog.tsx", // admin.whatsapp inbox
  "src/components/admin/WhatsappEnquiryContext.tsx", // admin.whatsapp inbox
  "src/components/admin/whatsapp/EnquiryResolutionPanel.tsx", // admin.whatsapp inbox
  "src/components/admin/whatsapp/ForwardedEnquiryForm.tsx", // admin.leads
  "src/components/admin/property-sync/WithdrawalReviewWorkspace.tsx", // admin.property-sync
]);

test("nativeFieldClassName is the 44 px field style with the 3:1 border", () => {
  const source = read("src/components/ui/native-field.ts");
  const value = source.match(/export const nativeFieldClassName =\s*"([^"]+)";/);
  assert.ok(value, "nativeFieldClassName is an exported string");
  const classes = value[1].split(/\s+/);
  for (const token of [
    "h-11",
    "w-full",
    "rounded-md",
    "border",
    "border-input",
    "bg-background",
    "px-3",
    "text-sm",
    "focus-visible:ring-2",
    "focus-visible:ring-ring",
    "focus-visible:ring-offset-2",
    "focus-visible:ring-offset-background",
    "disabled:opacity-50",
  ]) {
    assert.ok(classes.includes(token), token);
  }
});

test("native selects outside the 17b/17c screens use nativeFieldClassName", () => {
  const offenders = [];
  for (const file of sourceFiles("src/", /\.tsx$/)) {
    const path = relative(file);
    if (/\.test\.tsx$/.test(path) || NATIVE_SELECT_EXEMPT.has(path)) continue;
    const source = readFileSync(file, "utf8");
    // Local constants built from the shared class (e.g. `const control = cn(nativeFieldClassName, …)`).
    const aliases = [...source.matchAll(/const (\w+) =\s*cn\(\s*nativeFieldClassName\b/g)].map(
      (m) => m[1],
    );
    for (const match of source.matchAll(/<select\b/g)) {
      const tag = source.slice(match.index, source.indexOf("<option", match.index));
      const className = tag.match(/className=\{([^}]*)\}/)?.[1] ?? "";
      const usesShared =
        /\bnativeFieldClassName\b/.test(className) || aliases.includes(className.trim());
      if (!usesShared) {
        offenders.push(`${path}:${source.slice(0, match.index).split("\n").length}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
