import { describe, expect, test } from "bun:test";
import { load } from "cheerio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Container } from "./Container";
import { Prose } from "./Prose";
import { Section } from "./Section";
import { SectionHeading } from "./SectionHeading";

function render(node: ReturnType<typeof createElement>) {
  return load(renderToStaticMarkup(node));
}

describe("Container", () => {
  test("renders a div with the page-width and padding classes", () => {
    const $ = render(
      createElement(Container, { "data-testid": "container" }, "content"),
    );
    const el = $('[data-testid="container"]');
    expect(el).toHaveLength(1);
    expect(el.hasClass("mx-auto")).toBe(true);
    expect(el.hasClass("max-w-7xl")).toBe(true);
    expect(el.text()).toBe("content");
  });

  test("merges a caller-supplied className instead of overwriting the base classes", () => {
    const $ = render(
      createElement(
        Container,
        { "data-testid": "container", className: "bg-card" },
        "x",
      ),
    );
    const el = $('[data-testid="container"]');
    expect(el.hasClass("mx-auto")).toBe(true);
    expect(el.hasClass("bg-card")).toBe(true);
  });
});

describe("Section", () => {
  test("defaults to the plain tone with vertical padding and no border/background", () => {
    const $ = render(
      createElement(Section, { "data-testid": "section" }, "content"),
    );
    const el = $('[data-testid="section"]');
    expect(el.prop("tagName")).toBe("SECTION");
    expect(el.hasClass("py-12")).toBe(true);
    expect(el.hasClass("border-b")).toBe(false);
  });

  test("the muted tone adds the border and muted background", () => {
    const $ = render(
      createElement(
        Section,
        { "data-testid": "section", tone: "muted" },
        "content",
      ),
    );
    const el = $('[data-testid="section"]');
    expect(el.hasClass("border-b")).toBe(true);
    expect(el.hasClass("bg-muted/30")).toBe(true);
  });

  test("the card tone adds the card surface treatment", () => {
    const $ = render(
      createElement(Section, { "data-testid": "section", tone: "card" }, "x"),
    );
    const el = $('[data-testid="section"]');
    expect(el.hasClass("bg-card")).toBe(true);
    expect(el.hasClass("border-y")).toBe(true);
  });
});

describe("SectionHeading", () => {
  test("renders the eyebrow, title, and defaults to an h2", () => {
    const $ = render(
      createElement(SectionHeading, { eyebrow: "深井放盤", title: "精選筍盤" }),
    );
    expect($("h2").text()).toBe("精選筍盤");
    expect($("p").first().text()).toBe("深井放盤");
  });

  test("renders as h3 when as='h3' is passed", () => {
    const $ = render(
      createElement(SectionHeading, { title: "相關屋苑", as: "h3" }),
    );
    expect($("h3")).toHaveLength(1);
    expect($("h2")).toHaveLength(0);
  });

  test("omits the eyebrow paragraph when none is given", () => {
    const $ = render(createElement(SectionHeading, { title: "只有標題" }));
    expect($("p")).toHaveLength(0);
  });

  test("renders the action slot when provided", () => {
    const $ = render(
      createElement(SectionHeading, {
        title: "放盤",
        action: createElement("a", { href: "/listings" }, "查看全部"),
      }),
    );
    expect($('a[href="/listings"]').text()).toBe("查看全部");
  });

  test("forwards id to the heading element, not the wrapper, so aria-labelledby can target it", () => {
    const $ = render(
      createElement(SectionHeading, { id: "my-heading", title: "標題" }),
    );
    expect($("h2").attr("id")).toBe("my-heading");
  });
});

describe("Prose", () => {
  test("renders children inside a div with the prose typography classes", () => {
    const $ = render(
      createElement(
        Prose,
        { "data-testid": "prose" },
        createElement("p", null, "正文內容"),
      ),
    );
    const el = $('[data-testid="prose"]');
    expect(el).toHaveLength(1);
    expect(el.find("p").text()).toBe("正文內容");
  });
});
