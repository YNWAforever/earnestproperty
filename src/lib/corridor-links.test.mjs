import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { estateRegistry } from "../content/estate-registry.ts";
import { clientAreaGroupsInNavOrder } from "../content/client-area-presentation.ts";

async function helpers() {
  assert.ok(
    existsSync(new URL("./corridor-links.ts", import.meta.url)),
    "corridor links need a shared derivation",
  );
  return import("./corridor-links.ts");
}

test("blog estate references add canonical hub/segment links once, including single-estate articles", async () => {
  const { blogCorridorLinks } = await helpers();
  assert.deepEqual(
    blogCorridorLinks(["bellagio", "sea-crest-villa"]).map((link) => link.href),
    ["/castle-peak-road", "/castle-peak-road/sham-tseng"],
  );
  assert.deepEqual(
    blogCorridorLinks([], [{ href: "/estate/bellagio", label: "碧堤半島" }]).map(
      (link) => link.href,
    ),
    ["/castle-peak-road", "/castle-peak-road/sham-tseng"],
  );
  assert.deepEqual(
    blogCorridorLinks(["bellagio"], [{ href: "/castle-peak-road", label: "指南" }]).map(
      (link) => link.href,
    ),
    ["/castle-peak-road/sham-tseng"],
  );
  assert.deepEqual(
    blogCorridorLinks(
      ["bellagio"],
      [{ href: "/castle-peak-road#main-estates", label: "屋苑" }],
    ).map((link) => link.href),
    ["/castle-peak-road/sham-tseng"],
  );
});

test("unknown, unpublished and non-corridor estate references never invent corridor destinations", async () => {
  const { blogCorridorLinks } = await helpers();
  assert.deepEqual(blogCorridorLinks(), []);
  assert.deepEqual(blogCorridorLinks(["", "unknown", "null", "mun-ming-shan"]), []);
  const unpublished = estateRegistry.filter((estate) => !estate.hasPage || !estate.published);
  assert.ok(unpublished.length > 0);
  assert.deepEqual(blogCorridorLinks(unpublished.map((estate) => estate.slug)), []);
  assert.deepEqual(
    blogCorridorLinks([], [{ href: "https://example.test/estate/bellagio", label: "external" }]),
    [],
  );
});

test("footer includes the hub and Sham Tseng segment exactly once alongside area groups", async () => {
  const { corridorFooterLinks } = await helpers();
  const links = corridorFooterLinks();
  const paths = links.map((link) => link.href);
  assert.equal(paths.filter((path) => path === "/castle-peak-road").length, 1);
  assert.equal(paths.filter((path) => path === "/castle-peak-road/sham-tseng").length, 1);
  assert.equal(new Set(paths).size, paths.length);
  for (const group of clientAreaGroupsInNavOrder()) {
    assert.ok(
      links.some(
        (link) => link.href === group.href.split("#")[0] && link.label === `${group.label}買樓租樓`,
      ),
    );
  }
  assert.ok(paths.every((path) => !/district\/(ting-kau|tsuen-wan)|\/estate\/|[?#]/.test(path)));
});

// Route/component source wiring complements the pure derivation tests above.
test("blog and footer render derived corridor links through SiteLink", () => {
  const blog = readFileSync("src/routes/blog_.$slug.tsx", "utf8");
  const footer = readFileSync("src/components/site/SiteFooter.tsx", "utf8");
  assert.match(blog, /blogCorridorLinks\(\s*compareEstates\.map/);
  assert.match(blog, /relatedLinks\.map/);
  assert.match(blog, /<SiteLink[\s\S]*?href=\{link\.href\}/);
  assert.match(footer, /corridorFooterLinks\(\)\.map/);
  assert.match(footer, /<SiteLink href=\{group\.href\}/);
});
