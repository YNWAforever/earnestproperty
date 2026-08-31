import assert from "node:assert/strict";
import test from "node:test";

import { canonicalLink, seo, SITE_URL } from "./seo.ts";

test("canonicalLink returns a bare-path canonical, no query string assumptions", () => {
  assert.deepEqual(canonicalLink("/listings"), {
    rel: "canonical",
    href: `${SITE_URL}/listings`,
  });
});

test("seo() mirrors title/description into og:title/og:description and canonicalises the path", () => {
  const result = seo({ title: "T", description: "D", path: "/p" });
  assert.deepEqual(result.meta, [
    { title: "T" },
    { name: "description", content: "D" },
    { property: "og:title", content: "T" },
    { property: "og:description", content: "D" },
  ]);
  assert.deepEqual(result.links, [canonicalLink("/p")]);
});

test("seo() adds an og:image meta only when ogImage is passed", () => {
  const withImage = seo({ title: "T", description: "D", path: "/p", ogImage: "https://x/og.jpg" });
  assert.ok(withImage.meta.some((m) => "property" in m && m.property === "og:image"));

  const withoutImage = seo({ title: "T", description: "D", path: "/p" });
  assert.ok(!withoutImage.meta.some((m) => "property" in m && m.property === "og:image"));
});

test("seo() adds a noindex robots meta only when noindex is true", () => {
  const noindexed = seo({ title: "T", description: "D", path: "/p", noindex: true });
  assert.ok(
    noindexed.meta.some(
      (m) => "name" in m && m.name === "robots" && m.content === "noindex,follow",
    ),
  );

  const indexed = seo({ title: "T", description: "D", path: "/p" });
  assert.ok(!indexed.meta.some((m) => "name" in m && m.name === "robots"));
});
