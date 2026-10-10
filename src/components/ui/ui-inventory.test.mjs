import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// FX-19a-1 Task 1 (H-15): shadcn primitives that nothing imported were
// deleted. This guard keeps them gone and catches any file that starts
// importing one again (which would need the primitive restored on purpose).
const DELETED_UI_PRIMITIVES = [
  "aspect-ratio",
  "breadcrumb",
  "calendar",
  "carousel",
  "command",
  "context-menu",
  "drawer",
  "dropdown-menu",
  "form",
  "hover-card",
  "input-otp",
  "menubar",
  "navigation-menu",
  "pagination",
  "progress",
  "resizable",
  "separator",
  "sidebar",
  "toggle",
  "toggle-group",
];

const SCAN_ROOTS = ["src", "scripts", "e2e", "workers"];
const SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]sx?|css|json|html)$/;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".output", ".vercel", ".wrangler"]);

function listSourceFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(root, entry);
    if (statSync(path).isDirectory()) files.push(...listSourceFiles(path));
    else if (SOURCE_EXTENSIONS.test(entry)) files.push(path);
  }
  return files;
}

// An import specifier ends in a quote: `@/components/ui/form"`, `./toggle'`.
const importPatterns = [
  ...DELETED_UI_PRIMITIVES.map(
    (name) => new RegExp(`components/ui/${name}["'\`]|ui/${name}\\.tsx?["'\`]`),
  ),
  /hooks\/use-mobile(?:\.tsx?)?["'`]/,
];

test("no deleted UI primitive exists or is imported", () => {
  for (const name of DELETED_UI_PRIMITIVES) {
    assert.equal(
      existsSync(`src/components/ui/${name}.tsx`),
      false,
      `${name}.tsx should be deleted`,
    );
  }
  assert.equal(existsSync("src/hooks/use-mobile.tsx"), false, "use-mobile.tsx should be deleted");

  const offenders = [];
  for (const file of SCAN_ROOTS.flatMap(listSourceFiles)) {
    if (file.replaceAll("\\", "/").endsWith("src/components/ui/ui-inventory.test.mjs")) continue;
    const source = readFileSync(file, "utf8");
    for (const pattern of importPatterns) {
      if (pattern.test(source)) offenders.push(`${file} matches ${pattern}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the kept primitives chart and sonner are still present", () => {
  assert.equal(existsSync("src/components/ui/chart.tsx"), true);
  assert.equal(existsSync("src/components/ui/sonner.tsx"), true);
});
