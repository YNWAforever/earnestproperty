import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { renderToString } from "react-dom/server";

test("buyer, tenant and viewing guidance with source links is present in server-rendered HTML", async () => {
  const exists = existsSync(new URL("./EstateReviewGuides.tsx", import.meta.url));
  expect(exists).toBe(true);
  if (!exists) return;
  const { EstateReviewGuides } = await import("./EstateReviewGuides");
  const root = createRootRoute({ component: EstateReviewGuides });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const html = renderToString(<RouterProvider router={router} />);

  expect(html.match(/<details\b/g)?.length).toBe(3);
  for (const term of ["買樓", "租樓", "景觀", "成交", "租約", "交通"]) {
    expect(html).toContain(term);
  }
  expect(html).toContain(
    "https://www.gov.hk/tc/residents/housing/private/buying/buyingDomesticProperty.htm",
  );
  expect(html).toContain(
    "https://www.gov.hk/tc/residents/housing/private/buying/rentingDomesticProperty.htm",
  );
  expect(html).toContain("https://smart.eaa.org.hk/zh-HK/rent/3");
  expect(html).toContain("/blog/bellagio-vs-sea-crest-villa-vs-hong-kong-garden");
});
