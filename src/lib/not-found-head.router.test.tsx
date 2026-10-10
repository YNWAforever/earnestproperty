import { describe, expect, test } from "bun:test";
import {
  HeadContent,
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  notFound,
} from "@tanstack/react-router";
import { renderToString } from "react-dom/server";

import { isNotFound, NOT_FOUND_TITLE, notFoundHead } from "./not-found-head";

// FX-13 F-22: isNotFound reads router-core match state, including the
// underscore-named _notFound flag that the root notFound boundary sets
// (the root match stays status "success"). Fixture objects cannot catch a
// router-core bump that renames that flag, so this runs a real router with
// the same root setup as src/routes/__root.tsx: a root head that switches on
// isNotFound(matches) and a root notFoundComponent.
function buildRouter(path: string) {
  const root = createRootRoute({
    head: ({ matches }) => ({
      meta: isNotFound(matches)
        ? notFoundHead().meta
        : [{ title: "HOME" }, { name: "description", content: "home" }],
    }),
    component: () => (
      <>
        <HeadContent />
        <Outlet />
      </>
    ),
    notFoundComponent: () => null,
  });
  const home = createRoute({ getParentRoute: () => root, path: "/" });
  // Like castle-peak-road.$segment.tsx: loader notFound, no notFoundComponent,
  // so the root route is the boundary.
  const bubbles = createRoute({
    getParentRoute: () => root,
    path: "/segment/$segment",
    loader: () => {
      throw notFound();
    },
  });
  // Like estate.$slug.tsx: loader notFound caught by its own notFoundComponent.
  const ownBoundary = createRoute({
    getParentRoute: () => root,
    path: "/estate/$slug",
    loader: () => {
      throw notFound();
    },
    notFoundComponent: () => null,
  });
  return createRouter({
    routeTree: root.addChildren([home, bubbles, ownBoundary]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
}

async function load(path: string) {
  const router = buildRouter(path);
  await router.load();
  return router;
}

describe("isNotFound against a real router", () => {
  test("an unmatched URL is not found", async () => {
    const router = await load("/no-such-page");
    expect(isNotFound(router.state.matches)).toBe(true);
  });

  test("a matched URL is not", async () => {
    const router = await load("/");
    expect(isNotFound(router.state.matches)).toBe(false);
  });

  test("a child loader notFound that bubbles to the root is not found", async () => {
    const router = await load("/segment/unknown");
    expect(isNotFound(router.state.matches)).toBe(true);
  });

  test("a child loader notFound caught by the child's own boundary is not found", async () => {
    const router = await load("/estate/missing");
    expect(isNotFound(router.state.matches)).toBe(true);
  });

  test("the rendered head of an unmatched URL carries the 404 title and noindex", async () => {
    const router = await load("/no-such-page");
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toContain(`<title>${NOT_FOUND_TITLE}</title>`);
    expect(html).toContain('<meta name="robots" content="noindex"/>');
    expect(html).not.toContain("HOME");
  });

  test("the rendered head of a matched URL keeps its own title", async () => {
    const router = await load("/");
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toContain("<title>HOME</title>");
    expect(html).not.toContain(NOT_FOUND_TITLE);
  });
});
