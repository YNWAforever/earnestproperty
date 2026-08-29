import { describe, expect, test } from "bun:test";
import { load } from "cheerio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Container } from "./Container";
import { Section } from "./Section";

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
