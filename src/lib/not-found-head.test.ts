import { describe, expect, test } from "bun:test";

import { isNotFound, NOT_FOUND_TITLE, notFoundHead } from "./not-found-head";

// FX-13 F-22: an unmatched URL used to render the home page's title and
// description, so a 404 looked like a duplicate of "/" to crawlers.
describe("notFoundHead", () => {
  test("404 head uses its own title and noindex", () => {
    const { meta } = notFoundHead();
    expect(NOT_FOUND_TITLE).toBe("找不到頁面｜晉誠地產");
    expect(meta).toContainEqual({ title: "找不到頁面｜晉誠地產" });
    expect(meta).toContainEqual({ name: "robots", content: "noindex" });
    expect(meta.some((tag) => tag.property === "og:url")).toBe(false);
    expect(meta.some((tag) => tag.name === "description")).toBe(false);
    expect(meta).toContainEqual({ charSet: "utf-8" });
    expect(meta).toContainEqual({
      name: "viewport",
      content: "width=device-width, initial-scale=1",
    });
  });

  test("only a notFound match switches the head", () => {
    expect(isNotFound([{ status: "success" }, { status: "notFound" }])).toBe(true);
    expect(isNotFound([{ status: "success" }])).toBe(false);
    expect(isNotFound([])).toBe(false);
  });

  test("an unmatched URL caught by the root boundary also switches the head", () => {
    // router-core's load-server applyFailure: when the notFound boundary is the
    // root route, the root match keeps status "success" and carries the
    // router's _notFound flag instead (router.js treats it as not found too).
    expect(isNotFound([{ routeId: "__root__", status: "success", _notFound: true }])).toBe(true);
    expect(
      isNotFound([
        { routeId: "__root__", status: "success", _notFound: true },
        { routeId: "/estate/$slug", status: "success" },
      ]),
    ).toBe(true);
    expect(isNotFound([{ routeId: "__root__", status: "success", _notFound: false }])).toBe(false);
  });
});
