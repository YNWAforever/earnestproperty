import { describe, expect, test } from "bun:test";
import { load } from "cheerio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AppImage } from "./AppImage";

function render(node: ReturnType<typeof createElement>) {
  return load(renderToStaticMarkup(node));
}

describe("AppImage", () => {
  test("renders an img with src, alt, width, and height", () => {
    const $ = render(
      createElement(AppImage, {
        src: "https://example.com/photo.jpg",
        alt: "深井海景單位",
        width: 800,
        height: 600,
      }),
    );
    const img = $("img");
    expect(img).toHaveLength(1);
    expect(img.attr("src")).toBe("https://example.com/photo.jpg");
    expect(img.attr("alt")).toBe("深井海景單位");
    expect(img.attr("width")).toBe("800");
    expect(img.attr("height")).toBe("600");
  });

  test("defaults to loading=lazy and decoding=async", () => {
    const $ = render(
      createElement(AppImage, {
        src: "https://example.com/a.jpg",
        alt: "a",
        width: 1,
        height: 1,
      }),
    );
    const img = $("img");
    expect(img.attr("loading")).toBe("lazy");
    expect(img.attr("decoding")).toBe("async");
  });

  test("respects an explicit loading='eager' override for LCP candidates", () => {
    const $ = render(
      createElement(AppImage, {
        src: "https://example.com/a.jpg",
        alt: "a",
        width: 1,
        height: 1,
        loading: "eager",
      }),
    );
    expect($("img").attr("loading")).toBe("eager");
  });

  test("renders the default branded fallback and no img tag when src is null", () => {
    const $ = render(
      createElement(AppImage, {
        src: null,
        alt: "a",
        width: 1,
        height: 1,
        className: "h-64 w-full",
      }),
    );
    expect($("img")).toHaveLength(0);
    expect($.text()).toBe("晉誠地產");
    const fallback = $("div").first();
    expect(fallback.hasClass("h-64")).toBe(true);
    expect(fallback.hasClass("w-full")).toBe(true);
  });

  test("renders the default branded fallback and no img tag when src is undefined", () => {
    const $ = render(
      createElement(AppImage, {
        src: undefined,
        alt: "a",
        width: 1,
        height: 1,
        className: "h-64 w-full",
      }),
    );
    expect($("img")).toHaveLength(0);
    expect($.text()).toBe("晉誠地產");
    const fallback = $("div").first();
    expect(fallback.hasClass("h-64")).toBe(true);
    expect(fallback.hasClass("w-full")).toBe(true);
  });

  test("the default fallback receives the caller's className, matching what the img would have gotten", () => {
    const $ = render(
      createElement(AppImage, {
        src: null,
        alt: "a",
        width: 1,
        height: 1,
        className: "h-64 w-full",
      }),
    );
    const fallback = $("div").first();
    expect(fallback.hasClass("h-64")).toBe(true);
    expect(fallback.hasClass("w-full")).toBe(true);
  });

  test("renders a caller-supplied fallback instead of the default when src is missing", () => {
    const $ = render(
      createElement(AppImage, {
        src: null,
        alt: "a",
        width: 1,
        height: 1,
        fallback: createElement(
          "span",
          { "data-testid": "custom-fallback" },
          "無相片",
        ),
      }),
    );
    expect($('[data-testid="custom-fallback"]').text()).toBe("無相片");
    expect($.text()).not.toContain("晉誠地產");
  });

  test("defaults to object-cover but a caller className can override it to object-contain", () => {
    const $ = render(
      createElement(AppImage, {
        src: "https://example.com/logo.png",
        alt: "logo",
        width: 60,
        height: 60,
        className: "h-14 w-14 object-contain",
      }),
    );
    const img = $("img");
    expect(img.hasClass("object-contain")).toBe(true);
    expect(img.hasClass("object-cover")).toBe(false);
  });

  test("passes through arbitrary img attributes such as fetchPriority", () => {
    const $ = render(
      createElement(AppImage, {
        src: "https://example.com/logo.png",
        alt: "logo",
        width: 60,
        height: 60,
        fetchPriority: "high",
      }),
    );
    expect($("img").attr("fetchpriority")).toBe("high");
  });
});
