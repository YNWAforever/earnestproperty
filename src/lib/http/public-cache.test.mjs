import assert from "node:assert/strict";
import test from "node:test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  notFound,
  redirect,
} from "@tanstack/react-router";
import { _getRenderedMatches } from "@tanstack/router-core";

import { PUBLIC_CDN_CACHE, publicPageCacheHeaders } from "./public-cache.js";

const ok = (pathname, loaderData = { rows: [] }) => ({
  match: { status: "success", pathname },
  loaderData,
});

test("a successful public match gets max-age=60, stale-while-revalidate=300 on Vercel-CDN-Cache-Control only", () => {
  assert.equal(PUBLIC_CDN_CACHE, "max-age=60, stale-while-revalidate=300");
  for (const path of [
    "/",
    "/listings",
    "/property/T027001",
    "/estate/bellagio",
    "/castle-peak-road/",
    "/castle-peak-road/ting-kau",
    // Prefix lookalikes are public pages, not the private sections.
    "/whatsapp-guide",
    "/apis",
  ]) {
    const headers = publicPageCacheHeaders(ok(path));
    assert.deepEqual(headers, { "Vercel-CDN-Cache-Control": PUBLIC_CDN_CACHE }, path);
    assert.equal("Cache-Control" in headers, false);
    assert.equal("CDN-Cache-Control" in headers, false);
    assert.equal("Set-Cookie" in headers, false);
  }
});

test("public-cache refuses admin, auth, account, dashboard, api and w paths", () => {
  for (const path of [
    "/admin",
    "/admin/leads",
    "/auth/login",
    "/account/x",
    "/dashboard",
    "/api/woztell/webhook",
    "/w/abc",
    "/_serverFn/x",
  ]) {
    assert.equal(publicPageCacheHeaders(ok(path)), undefined, path);
  }
});

test("a failed, not-found or loader-less match gets no CDN header", () => {
  for (const status of ["error", "notFound", "pending", "redirected"]) {
    assert.equal(
      publicPageCacheHeaders({ match: { status, pathname: "/" }, loaderData: { rows: [] } }),
      undefined,
      status,
    );
  }
  assert.equal(
    publicPageCacheHeaders({ match: { status: "success", pathname: "/" }, loaderData: undefined }),
    undefined,
  );
  assert.equal(
    publicPageCacheHeaders({ match: { status: "success", pathname: "/" }, loaderData: null }),
    undefined,
  );
});

test("require() can veto caching", () => {
  const requireProperty = { require: (d) => Boolean(d?.property) };
  assert.equal(
    publicPageCacheHeaders(ok("/property/X", { property: null }), requireProperty),
    undefined,
  );
  assert.deepEqual(
    publicPageCacheHeaders(ok("/property/X", { property: { id: "1" } }), requireProperty),
    {
      "Vercel-CDN-Cache-Control": PUBLIC_CDN_CACHE,
    },
  );
});

// Runs TanStack Router's real server load path (the one createStartHandler
// uses: router.load() on the server, then the headers of
// _getRenderedMatches merged root to leaf) so the guard is proven against
// the statuses TanStack actually hands to `headers`, not assumed ones.
async function serverResponse(pathname) {
  const root = createRootRoute({ notFoundComponent: () => null });
  const routes = [
    createRoute({
      getParentRoute: () => root,
      path: "/ok",
      loader: async () => ({ rows: [1] }),
      headers: publicPageCacheHeaders,
    }),
    // No own notFoundComponent: the root becomes the 404 boundary.
    createRoute({
      getParentRoute: () => root,
      path: "/gone",
      loader: async () => {
        throw notFound();
      },
      headers: publicPageCacheHeaders,
    }),
    // Own notFoundComponent, like property and estate.
    createRoute({
      getParentRoute: () => root,
      path: "/property/$listingNo",
      loader: async ({ params }) => {
        if (params.listingNo === "ZZZ999999") throw notFound();
        return { property: { id: params.listingNo } };
      },
      headers: (ctx) => publicPageCacheHeaders(ctx, { require: (d) => Boolean(d?.property) }),
      notFoundComponent: () => null,
    }),
    createRoute({
      getParentRoute: () => root,
      path: "/db-down",
      loader: async () => {
        throw new Error("Neon unreachable");
      },
      headers: publicPageCacheHeaders,
      errorComponent: () => null,
    }),
    // A loader whose first read succeeds and a later one times out.
    createRoute({
      getParentRoute: () => root,
      path: "/partial-timeout",
      loader: async () => {
        const first = await Promise.resolve({ rows: [1] });
        await new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5));
        return first;
      },
      headers: publicPageCacheHeaders,
    }),
    createRoute({
      getParentRoute: () => root,
      path: "/moved",
      loader: async () => {
        throw redirect({ href: "/ok", statusCode: 301 });
      },
      headers: publicPageCacheHeaders,
    }),
    createRoute({
      getParentRoute: () => root,
      path: "/admin",
      loader: async () => ({ rows: [1] }),
      headers: publicPageCacheHeaders,
    }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [pathname] }),
    isServer: true,
  });
  await router.load();
  const result = router._serverResult;
  const headers = new Headers();
  for (const match of _getRenderedMatches(router.stores.matches.get())) {
    for (const [key, value] of Object.entries(match.headers ?? {})) headers.set(key, value);
  }
  return {
    type: result?.type,
    status: result?.status,
    cdn: headers.get("Vercel-CDN-Cache-Control"),
  };
}

test("TanStack's server load only attaches the CDN header to a 200 render", async () => {
  assert.deepEqual(await serverResponse("/ok"), {
    type: "render",
    status: 200,
    cdn: PUBLIC_CDN_CACHE,
  });
  assert.deepEqual(await serverResponse("/property/T027001"), {
    type: "render",
    status: 200,
    cdn: PUBLIC_CDN_CACHE,
  });
  for (const [path, type, status] of [
    ["/gone", "render", 404],
    ["/property/ZZZ999999", "render", 404],
    ["/no-such-route", "render", 404],
    ["/db-down", "render", 500],
    ["/partial-timeout", "render", 500],
    ["/moved", "redirect", undefined],
    ["/admin", "render", 200],
  ]) {
    assert.deepEqual(await serverResponse(path), { type, status, cdn: null }, path);
  }
});
