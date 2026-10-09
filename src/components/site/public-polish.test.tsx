import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, mock, test } from "bun:test";
import { load } from "cheerio";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// FX-16 F-16 / F-20: phone links are tel:+852, and Chinese headings carry no negative tracking.
// SiteFooter renders router <Link>, which throws outside a RouterProvider, so it is mocked to <a>.
mock.module("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children?: ReactNode; className?: string }) =>
    createElement("a", { href: to, className }, children),
}));

const { SiteFooter } = await import("./SiteFooter");
const { SITE_BRANCHES } = await import("@/config/site");
const { toTelHref } = await import("@/lib/contact-links");

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("footer and contact phone links are tel:+852", () => {
  const $ = load(renderToStaticMarkup(createElement(SiteFooter)));
  const hrefs = $("a[href^='tel:']")
    .map((_, el) => $(el).attr("href"))
    .get();
  expect(hrefs.length).toBeGreaterThanOrEqual(SITE_BRANCHES.length);
  for (const href of hrefs) expect(href).toMatch(/^tel:\+852\d{8}$/);
  for (const branch of SITE_BRANCHES) expect(hrefs).toContain(toTelHref(branch.phone)!);

  const contact = source("src/routes/contact.tsx");
  expect(contact).toContain("toTelHref(branch.phone)");
  expect(contact).not.toContain("`tel:${branch.phone}`");
  expect(contact).not.toContain("`tel:${SITE_CONTACT.phoneTel}`");
});
