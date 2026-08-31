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

    const baseSourcePath = `src/routes/${filePath.replace("./routes/", "")}`;
    const tsxPath = `${baseSourcePath}.tsx`;
    const tsPath = `${baseSourcePath}.ts`;

    // A `.ts`-only route (server handlers, see CLAUDE.md's `api.*.ts` convention
    // -- e.g. api.youtube-sync.full.ts nesting under api.youtube-sync.ts) renders
    // no JSX at all: it nests by path prefix, not by a parent component mounting
    // an <Outlet/>. The Outlet requirement below only makes sense for a `.tsx`
    // page component, so a source file that exists only as `.ts` is exempt.
    if (!existsSync(join(root, tsxPath)) && existsSync(join(root, tsPath))) {
      continue;
    }

    const source = read(tsxPath);
    assert.match(
      source,
      /<Outlet\s*\/>/,
      `${tsxPath} has nested children in routeTree.gen.ts and must render <Outlet/> ` +
        `(if it should instead be a standalone page, its children should opt out of nesting ` +
        `with the '_' suffix, as blog_.$slug.tsx and agents_.$slug.tsx do)`,
    );
  }
});

// P5e1 Task 4: blog_.$slug.tsx grew a ToC, byline, sources note, answer-summary
// box, and a live comparison table. This is a source-text scan (like the rest
// of this file) rather than a rendered-DOM assertion, since blog_.$slug.tsx's
// component reads its own createFileRoute loader data via Route.useLoaderData(),
// which isn't available outside a real router context.
test("blog article template renders a ToC that anchors each section heading", () => {
  const source = read("src/routes/blog_.$slug.tsx");
  assert.match(source, /aria-label="目錄"/, "article should render a ToC nav");
  assert.match(
    source,
    /article\.sections\.length >= 2/,
    "ToC should only render for 2+ sections (a single-section article doesn't need one)",
  );
  assert.match(
    source,
    /href=\{`#\$\{sectionAnchors\[index\]\}`\}/,
    "each ToC entry should link to its section's anchor id",
  );
});

test("blog article template renders an author byline unconditionally and a reviewer byline only when set", () => {
  const source = read("src/routes/blog_.$slug.tsx");
  assert.match(source, /作者：\{article\.author\}/, "author should always render");
  assert.match(
    source,
    /\{article\.reviewer && <span>審閱：\{article\.reviewer\}<\/span>\}/,
    "reviewer should only render when non-null -- never a fabricated placeholder",
  );
});

test("blog article template renders an answer-summary callout before the ToC", () => {
  // P7e: extracted into a shared AnswerSummaryCallout (reused by
  // estate.$slug.tsx too) -- the conditional-render and "重點摘要" label now
  // live in that component, not duplicated in this route's own source.
  const source = read("src/routes/blog_.$slug.tsx");
  assert.match(
    source,
    /import \{ AnswerSummaryCallout \} from "@\/components\/site\/AnswerSummaryCallout";/,
  );
  assert.match(source, /<AnswerSummaryCallout summary={article\.answerSummary} \/>/);

  const component = read("src/components/site/AnswerSummaryCallout.tsx");
  assert.match(component, /if \(!summary\) return null;/, "should hide, not fabricate, a summary");
  assert.match(component, /重點摘要/, "answer summary should be visually labelled as a summary");
});

test("blog article template mounts the live comparison table when compareEstateSlugs is present", () => {
  const source = read("src/routes/blog_.$slug.tsx");
  assert.match(
    source,
    /import \{\s*BlogEstateComparisonTable/,
    "should import the neutral N-way comparison table component",
  );
  assert.match(
    source,
    /compareEstates\.length > 0 && <BlogEstateComparisonTable estates=\{compareEstates\} \/>/,
    "comparison table should mount only when there are estates to compare",
  );
  assert.match(
    source,
    /fetchEstateBySlug/,
    "comparison rows should be fetched live, never hand-typed",
  );
});

// P5e1 Task 5: /blog gained category filter chips, a search box, and richer
// card metadata (author, published date, cover image).
test("blog list renders a category filter for every named category plus an 全部 option", () => {
  const source = read("src/routes/blog.tsx");
  assert.match(
    source,
    /CATEGORY_FILTERS = \["全部", \.\.\.BLOG_CATEGORIES\]/,
    "category filter should cover 全部 plus every BLOG_CATEGORIES entry, not a hand-picked subset",
  );
  assert.match(source, /aria-pressed=\{selectedCategory === category\}/);
});

test("blog list renders a client-side search box over the loaded articles", () => {
  const source = read("src/routes/blog.tsx");
  assert.match(source, /type="search"/, "search input should exist");
  assert.match(
    source,
    /matchesSearch\(searchQuery, \[article\.title, article\.excerpt, article\.category\]\)/,
    "search should filter by title/excerpt/category, no new DB query",
  );
});

test("blog list cards show author (defaulting to the editorial byline) and published date", () => {
  const source = read("src/routes/blog.tsx");
  assert.match(
    source,
    /\{article\.author \?\? EDITORIAL_AUTHOR\}/,
    "DB-sourced articles with no author column should default to the org byline, not a per-article guess",
  );
  assert.match(source, /formatHkDate\(article\.published_at\)/);
});

test("blog list cards render a cover image only when one exists", () => {
  const source = read("src/routes/blog.tsx");
  assert.match(
    source,
    /\{article\.cover_image && \(\s*<AppImage/,
    "cover image should be conditionally rendered, not a fallback box on every card",
  );
});
