import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

// P5e1 Task 6: the editorial-standards page is a trust signal, not an admin
// tool -- unlike admin.*.tsx routes it must stay crawlable, so this asserts
// the *absence* of the noindex meta every admin route carries (see the
// admin.*.tsx `{ name: "robots", content: "noindex" }` pattern this project
// already uses elsewhere).
test("/blog/editorial-standards exists, is not noindexed, and covers sourcing + links to /disclaimer", () => {
  const routePath = "src/routes/blog_.editorial-standards.tsx";
  assert.equal(existsSync(join(root, routePath)), true, "editorial-standards route should exist");

  const source = read(routePath);
  assert.match(source, /createFileRoute\("\/blog_\/editorial-standards"\)/);
  assert.doesNotMatch(
    source,
    /noindex/,
    "editorial-standards is a trust signal and must stay crawlable, unlike admin routes",
  );
  assert.match(source, /資料來源/, "page should explain where article facts come from");
  assert.match(
    source,
    /<Link to="\/disclaimer"/,
    "page should link to /disclaimer rather than duplicating its legal content",
  );

  const routeTree = read("src/routeTree.gen.ts");
  assert.match(routeTree, /from ['"]\.\/routes\/blog_\.editorial-standards['"]/);
  const block = routeTree.match(/const BlogEditorialStandardsRoute = [\s\S]*?\n\} as any\)/)?.[0];
  assert.ok(block, "editorial-standards route should be registered in the generated route tree");
  assert.match(block, /path: ['"]\/blog\/editorial-standards['"]/);
  assert.match(block, /getParentRoute: \(\) => rootRouteImport/);
});

test("blog list and article template both link to /blog/editorial-standards", () => {
  assert.match(
    read("src/routes/blog.tsx"),
    /to="\/blog\/editorial-standards"/,
    "blog list should link to the editorial-standards page",
  );
  assert.match(
    read("src/routes/blog_.$slug.tsx"),
    /to="\/blog\/editorial-standards"/,
    "article byline should link to the editorial-standards page",
  );
});
