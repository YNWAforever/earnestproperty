import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("blog detail is a root-owned non-nested route that can render independently", () => {
  const detailPath = "src/routes/blog_.$slug.tsx";
  const routeTree = read("src/routeTree.gen.ts");

  assert.equal(existsSync(join(root, detailPath)), true, "non-nested blog detail should exist");
  assert.equal(
    existsSync(join(root, "src/routes/blog.$slug.tsx")),
    false,
    "nested blog detail should be removed",
  );
  assert.match(read(detailPath), /createFileRoute\("\/blog_\/\$slug"\)/);
  assert.match(routeTree, /from ['"]\.\/routes\/blog_\.\$slug['"]/);

  const block = routeTree.match(/const BlogSlugRoute = [\s\S]*?\n\} as any\)/)?.[0];
  assert.ok(block, "BlogSlugRoute should be registered in the generated route tree");
  assert.match(block, /id: ['"]\/blog_\/\$slug['"]/);
  assert.match(block, /path: ['"]\/blog\/\$slug['"]/);
  assert.match(block, /getParentRoute: \(\) => rootRouteImport/);
  assert.doesNotMatch(block, /getParentRoute: \(\) => BlogRoute/);

  // /blog itself must stay a full page (no Outlet) precisely because it now has
  // no children to render -- if a future route re-nests under it, this pairs
  // with the generic layout-outlet guard below to catch the same bug again.
  const blogList = read("src/routes/blog.tsx");
  assert.doesNotMatch(blogList, /<Outlet\s*\/>/);
});

// Generalises the bug this suite exists to prevent: blog.tsx had layout-route
// *shape* (a route with a nested child in routeTree.gen.ts) but page-route
// *content* (no <Outlet/>), so the child's loader/head ran while its component
// never mounted. Any route file that is a real parent in the generated tree
// must render <Outlet/>; any route that should stand alone must opt out of
// nesting via the `_` suffix convention (see agents.tsx/agents_.$slug.tsx).
//
// src/routes/dashboard.tsx had this exact bug shape (its three children --
// dashboard.inquiries.tsx, dashboard.property.new.tsx, dashboard.property.$id.tsx --
// were nested but the parent had no Outlet, so all three were unreachable). It
// carried no inbound links and was fully superseded by /admin/listings and
// /admin/leads (same PropertyForm component, already nav-linked), so the whole
// /dashboard/* family was deleted rather than patched with an Outlet.
test("every route with children in the generated tree renders an Outlet", () => {
  const routeTree = read("src/routeTree.gen.ts");

  const importFileByRouteImportName = new Map();
  for (const match of routeTree.matchAll(
    /import \{ Route as (\w+RouteImport) \} from '(\.\/routes\/[^']+)'/g,
  )) {
    importFileByRouteImportName.set(match[1], match[2]);
  }

  const childParents = [];
  for (const match of routeTree.matchAll(
    /const \w+Route = \w+RouteImport\.update\(\{[\s\S]*?getParentRoute: \(\) => (\w+)[\s\S]*?\n\} as any\)/g,
  )) {
    const [, parentVariable] = match;
    if (parentVariable !== "rootRouteImport") {
      childParents.push(parentVariable);
    }
  }

  const parentsWithChildren = new Set(childParents);
  assert.ok(
    parentsWithChildren.size > 0,
    "sanity check: some routes should be nested (e.g. admin.*)",
  );

  for (const parentRouteName of parentsWithChildren) {
    const parentImportName = `${parentRouteName}Import`;
    const filePath = importFileByRouteImportName.get(parentImportName);
    assert.ok(filePath, `route tree should import a source file for ${parentRouteName}`);

    const sourcePath = `src/routes/${filePath.replace("./routes/", "")}.tsx`;
    const source = read(sourcePath);
    assert.match(
      source,
      /<Outlet\s*\/>/,
      `${sourcePath} has nested children in routeTree.gen.ts and must render <Outlet/> ` +
        `(if it should instead be a standalone page, its children should opt out of nesting ` +
        `with the '_' suffix, as blog_.$slug.tsx and agents_.$slug.tsx do)`,
    );
  }
});
