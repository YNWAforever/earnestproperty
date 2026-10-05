import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";

// Typed locally rather than through `declare global`: admin-whatsapp-mobile.spec.ts already
// declares window.noLinkFixture with a narrower shape, and both files share one tsc program.
type AttentionCounts = {
  unansweredConversations: number;
  unassignedLeads: number;
  staleNewLeads: number;
  leadsNeedingAttention: number;
};
type FixtureWindow = {
  noLinkFixture: {
    calls: { name: string; input?: unknown }[];
    attentionMode: "ok" | "failure" | "pending";
    attentionCounts: AttentionCounts;
    pendingAttention: (() => void)[];
  };
  noLinkOutboundFixture: { calls: unknown[] };
};
const ids = { a: "10000000-0000-4000-8000-000000000001" };
const POLL = 60_000;
const TITLE = "Isolated synthetic inbox";
let server: Server, origin: string;
const errors = new WeakMap<Page, string[]>();

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  assert.ok(!process.env.PLAYWRIGHT_BASE_URL, "This suite owns its isolated target");
  assert.equal(
    spawnSync(process.execPath, ["scripts/browser-fixtures/build-whatsapp-no-link.mjs"], {
      stdio: "inherit",
    }).status,
    0,
  );
  const root = resolve(".audit/no-link-browser");
  server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url!, "http://127.0.0.1").pathname;
      const target = path.startsWith("/assets/")
        ? resolve(root, `.${decodeURIComponent(path)}`)
        : resolve(root, "index.html");
      assert.ok(target.startsWith(root + sep));
      response.setHeader(
        "Content-Type",
        (
          {
            ".js": "text/javascript",
            ".css": "text/css",
            ".html": "text/html",
            ".woff2": "font/woff2",
          } as Record<string, string>
        )[extname(target)] ?? "application/octet-stream",
      );
      response.end(await readFile(target));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== "passed") return;
  expect(errors.get(page)).toEqual([]);
  expect(
    await page.evaluate(
      () => (window as unknown as FixtureWindow).noLinkOutboundFixture.calls.length,
    ),
  ).toBe(0);
  const mutations = await page.evaluate(() =>
    (window as unknown as FixtureWindow).noLinkFixture.calls.filter((c) =>
      [
        "sendReply",
        "sendTemplate",
        "updateConversation",
        "backfill",
        "consent",
        "confirmStaff",
        "staffHelp",
        "correctEnquiry",
        "contactEdit",
        "leadAi",
        "approveTag",
        "rejectTag",
        "leadActivity",
        "bulkLeads",
        "updateLead",
      ].includes(c.name),
    ),
  );
  expect(mutations).toHaveLength(0);
});

async function open(page: Page) {
  const captured: string[] = [];
  errors.set(page, captured);
  page.on("pageerror", (error) => captured.push(error.message));
  await page.route("**/*", (route) => {
    const request = route.request();
    if (new URL(request.url()).origin === origin && ["GET", "HEAD"].includes(request.method()))
      return route.continue();
    captured.push("Blocked external or mutation request");
    return route.abort();
  });
  await page.addInitScript(() => sessionStorage.setItem("no-link-fixture-actor", "agent-a"));
  // Before navigation, so every timer the app creates is on the controlled clock.
  await page.clock.install({ time: new Date("2026-10-05T02:00:00Z") });
  await page.goto(origin + "/admin/whatsapp?conversation=" + ids.a);
  await expect(page.getByLabel("WhatsApp 回覆").filter({ visible: true })).toBeVisible();
  // Exactly one read on load: nothing else in the shell or the page asks for the counts.
  await expect.poll(() => callCount(page, "attention")).toBe(1);
}

function callCount(page: Page, name: string, resource?: string) {
  return page.evaluate(
    ({ name, resource }) =>
      (window as unknown as FixtureWindow).noLinkFixture.calls.filter(
        (c) =>
          c.name === name &&
          (resource === undefined ||
            (c.input as { resource?: unknown } | undefined)?.resource === resource),
      ).length,
    { name, resource },
  );
}

function setFixture(page: Page, patch: Partial<FixtureWindow["noLinkFixture"]>) {
  return page.evaluate(
    (patch) => void Object.assign((window as unknown as FixtureWindow).noLinkFixture, patch),
    patch,
  );
}

function setVisibility(page: Page, state: "hidden" | "visible") {
  return page.evaluate((state) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => state === "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

const nav = (page: Page) =>
  page.getByRole("navigation", { name: "後台選單" }).filter({ visible: true });
const inboxLink = (page: Page) =>
  nav(page).getByRole("link", { name: "WhatsApp 收件匣", exact: true });
const leadsLink = (page: Page) => nav(page).getByRole("link", { name: "客戶查詢", exact: true });
const inboxBadge = (page: Page) => inboxLink(page).locator('[data-attention-badge="inbox"]');
const leadsBadge = (page: Page) => leadsLink(page).locator('[data-attention-badge="leads"]');

async function expectNoAlertOrToast(page: Page) {
  await expect(nav(page).locator('[role="alert"]')).toHaveCount(0);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
}

test("nav badges show waiting work and the link names stay exact", async ({ page }) => {
  await open(page);

  await expect(inboxLink(page)).toHaveAccessibleDescription("2 個對話待回覆");
  await expect(inboxBadge(page)).toHaveText("2");
  await expect(inboxBadge(page)).toHaveAttribute("aria-hidden", "true");
  await expect(leadsLink(page)).toBeVisible();
  await expect(leadsLink(page).locator("[data-attention-badge]")).toHaveCount(0);
  await expect(leadsLink(page)).toHaveAccessibleDescription("");
  await expect(page).toHaveTitle(`(2) ${TITLE}`);

  const current = nav(page).locator('[aria-current="page"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveAccessibleName("WhatsApp 收件匣");
});

test("a poll updates the badges and the tab title", async ({ page }) => {
  await open(page);
  const before = await callCount(page, "attention");
  // One lead is both unassigned and stale: the 客戶查詢 badge counts distinct leads (2, not 3).
  await setFixture(page, {
    attentionCounts: {
      unansweredConversations: 5,
      unassignedLeads: 1,
      staleNewLeads: 2,
      leadsNeedingAttention: 2,
    },
  });

  await page.clock.runFor(POLL);

  await expect(inboxBadge(page)).toHaveText("5");
  await expect(leadsBadge(page)).toHaveText("2");
  await expect(leadsLink(page)).toHaveAccessibleDescription(
    "未指派 1 宗；逾 2 小時未跟進的新查詢 2 宗",
  );
  await expect(inboxLink(page)).toHaveAccessibleDescription("5 個對話待回覆");
  await expect(page).toHaveTitle(`(7) ${TITLE}`);
  expect(await callCount(page, "attention")).toBe(before + 1);
});

test("a failed count read keeps the last badges and title", async ({ page }) => {
  await open(page);
  const before = await callCount(page, "attention");
  await setFixture(page, { attentionMode: "failure" });

  await page.clock.runFor(POLL);

  await expect.poll(() => callCount(page, "attention")).toBe(before + 1);
  await expect(inboxBadge(page)).toHaveText("2");
  await expect(page).toHaveTitle(`(2) ${TITLE}`);
  await expectNoAlertOrToast(page);
});

test("a slow count read is never doubled, and a hung one is dropped after 30 s", async ({
  page,
}) => {
  await open(page);
  const before = await callCount(page, "attention");
  await setFixture(page, { attentionMode: "pending" });

  await page.clock.runFor(POLL);
  await expect.poll(() => callCount(page, "attention")).toBe(before + 1);

  // Opening another admin page mounts a new shell, whose stale-count check joins the read in
  // flight instead of sending a second one. 客戶查詢 is the one highlighted entry there.
  await leadsLink(page).click();
  await expect(page).toHaveURL(/\/admin\/leads$/);
  const current = nav(page).locator('[aria-current="page"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveAccessibleName("客戶查詢");
  expect(await callCount(page, "attention")).toBe(before + 1);

  // The hung read times out: the last badges and title stay, with no alert and no toast.
  await page.clock.runFor(30_000);
  await expect(inboxBadge(page)).toHaveText("2");
  await expect(page).toHaveTitle(`(2) ${TITLE}`);
  await expectNoAlertOrToast(page);

  // ...and polling did not stall behind it: the next tick reads again.
  await setFixture(page, {
    attentionMode: "ok",
    attentionCounts: {
      unansweredConversations: 4,
      unassignedLeads: 0,
      staleNewLeads: 0,
      leadsNeedingAttention: 0,
    },
  });
  await page.clock.runFor(POLL);
  await expect.poll(() => callCount(page, "attention")).toBe(before + 2);
  await expect(inboxBadge(page)).toHaveText("4");
  await expect(page).toHaveTitle(`(4) ${TITLE}`);

  // The abandoned read answering late changes nothing.
  await setFixture(page, {
    attentionCounts: {
      unansweredConversations: 9,
      unassignedLeads: 0,
      staleNewLeads: 0,
      leadsNeedingAttention: 0,
    },
  });
  await page.evaluate(() =>
    (window as unknown as FixtureWindow).noLinkFixture.pendingAttention.forEach((release) =>
      release(),
    ),
  );
  await page.evaluate(() => new Promise((done) => setTimeout(done, 0)));
  await expect(inboxBadge(page)).toHaveText("4");
  await expect(page).toHaveTitle(`(4) ${TITLE}`);
  expect(await callCount(page, "attention")).toBe(before + 2);
});

test("polling pauses while hidden and resumes once when visible", async ({ page }) => {
  await open(page);
  const before = await callCount(page, "attention");

  await setVisibility(page, "hidden");
  await page.clock.runFor(3 * POLL);
  expect(await callCount(page, "attention")).toBe(before);

  // Returning after a missed tick reads once at once, without advancing the clock.
  await setVisibility(page, "visible");
  await expect.poll(() => callCount(page, "attention")).toBe(before + 1);

  await page.clock.runFor(POLL - 1_000);
  expect(await callCount(page, "attention")).toBe(before + 1);
  await page.clock.runFor(1_000);
  await expect.poll(() => callCount(page, "attention")).toBe(before + 2);
});
