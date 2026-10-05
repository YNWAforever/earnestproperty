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
    pushInbound: (id: string, text: string) => void;
    listMode: "ok" | "pending" | "failure";
    pendingList: (() => void)[];
    pendingAgents: (() => void)[];
    listPageSize: number | null;
  };
  noLinkOutboundFixture: { calls: unknown[] };
  noLinkStaffWorkFixture: { calls: { name: string }[] };
  __sameDocument?: boolean;
  __handoffChecking?: boolean;
};
const ids = {
  a: "10000000-0000-4000-8000-000000000001",
  b: "10000000-0000-4000-8000-000000000002",
};
const POLL = 60_000;
const TITLE = "Isolated synthetic inbox";
const NEW_INBOUND = "合成新訊息：想約睇樓";
const DRAFT = "合成草稿：請稍等，我查一查";
const CHECKING_HANDOFFS = "正在核對接手工作，完成讀回前不能更新。";
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
  // From here on only runFor moves the page's clock, so a "not yet" check never depends on how
  // long a step took in real time. Five seconds ahead of the page's own time, so pausing never
  // has to step back even on a starved worker; the next poll is still about a minute away.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 5_000));
}

/** Lets the page finish one task (its timers are paused, so this is not a setTimeout). */
function nextTask(page: Page) {
  return page.evaluate(
    () =>
      new Promise<void>((done) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => done();
        channel.port2.postMessage(null);
      }),
  );
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

const listReads = (page: Page) => callCount(page, "page", "conversations");

/** The reads behind the open thread; a list poll must leave every one of them alone. */
async function threadReads(page: Page) {
  return {
    detail: await callCount(page, "detail"),
    messages: await callCount(page, "page", "messages"),
    ai: await callCount(page, "ai-read"),
  };
}

function pushInbound(page: Page, id: string, text: string) {
  return page.evaluate(
    ({ id, text }) => (window as unknown as FixtureWindow).noLinkFixture.pushInbound(id, text),
    { id, text },
  );
}

/** Answers every held conversations-list read (see the fixture's listMode "pending"). */
function releaseListReads(page: Page) {
  return page.evaluate(() =>
    (window as unknown as FixtureWindow).noLinkFixture.pendingList
      .splice(0)
      .forEach((release) => release()),
  );
}

const reply = (page: Page) => page.getByLabel("WhatsApp 回覆").filter({ visible: true });
const refreshButton = (page: Page) =>
  page.getByRole("button", { name: "重新整理", exact: true }).filter({ visible: true });
/** A row of the conversation list: one button holding the customer's name and latest message. */
const listRow = (page: Page, text: string) => page.getByRole("button").filter({ hasText: text });

/** 我的接手工作's reads (StaffNotificationPanel -> the fixture's fetchMyStaffNotifications). */
const handoffReads = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as FixtureWindow).noLinkStaffWorkFixture.calls.filter(
        (c) => c.name === "read",
      ).length,
  );

/**
 * No error surface anywhere, not only in the nav. The fixture renders the route without the
 * app's <main>, so this checks the whole document (a superset of <main>).
 */
async function expectNoAlertOnPage(page: Page) {
  await expect(page.locator('[role="alert"]')).toHaveCount(0);
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
  await nextTask(page);
  await expect(inboxBadge(page)).toHaveText("4");
  await expect(page).toHaveTitle(`(4) ${TITLE}`);
  expect(await callCount(page, "attention")).toBe(before + 2);
});

test("polling pauses while hidden and resumes once when visible", async ({ page }) => {
  await open(page);
  const before = await callCount(page, "attention");
  const listBefore = await listReads(page);

  await setVisibility(page, "hidden");
  await page.clock.runFor(3 * POLL);
  expect(await callCount(page, "attention")).toBe(before);
  expect(await listReads(page)).toBe(listBefore);

  // Returning after a missed tick reads once at once, without advancing the clock.
  await setVisibility(page, "visible");
  await expect.poll(() => callCount(page, "attention")).toBe(before + 1);
  await expect.poll(() => listReads(page)).toBe(listBefore + 1);

  await page.clock.runFor(POLL - 1_000);
  expect(await callCount(page, "attention")).toBe(before + 1);
  expect(await listReads(page)).toBe(listBefore + 1);
  await page.clock.runFor(1_000);
  await expect.poll(() => callCount(page, "attention")).toBe(before + 2);
  await expect.poll(() => listReads(page)).toBe(listBefore + 2);
});

test("a new inbound appears in the list after one poll, without a reload or a thread re-read", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    (window as unknown as FixtureWindow).__sameDocument = true;
  });
  const list = await listReads(page);
  const thread = await threadReads(page);

  await pushInbound(page, ids.b, NEW_INBOUND);
  // Nothing shows the new message until the poll reads the list.
  await expect(page.getByRole("button").filter({ hasText: NEW_INBOUND })).toHaveCount(0);
  await page.clock.runFor(POLL);

  await expect.poll(() => listReads(page)).toBe(list + 1);
  await expect(page.getByRole("button").filter({ hasText: NEW_INBOUND })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__sameDocument)).toBe(true);
  expect(await threadReads(page)).toEqual(thread);
  expect(await listReads(page)).toBe(list + 1);
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`${viewport.width} × ${viewport.height}`, () => {
    test.use({ viewport });

    test("draft, selected conversation and thread scroll survive two poll cycles", async ({
      page,
    }) => {
      await open(page);
      await reply(page).fill(DRAFT);
      // Located as in admin-whatsapp-mobile.spec.ts: the scroller around the newest message.
      const last = page
        .locator("p.whitespace-pre-wrap.break-words")
        .filter({ hasText: "合成訊息 30" })
        .filter({ visible: true })
        .last();
      await expect(last).toBeVisible();
      const timeline = last.locator("xpath=ancestor::div[contains(@class,'overflow-y-auto')][1]");
      await timeline.evaluate((element) => {
        element.scrollTop = 120;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      const scrollTop = await timeline.evaluate((element) => element.scrollTop);
      expect(scrollTop).toBe(120);
      const list = await listReads(page);
      const thread = await threadReads(page);

      await page.clock.runFor(POLL);
      await expect.poll(() => listReads(page)).toBe(list + 1);
      await nextTask(page);
      await page.clock.runFor(POLL);
      await expect.poll(() => listReads(page)).toBe(list + 2);
      await nextTask(page);

      await expect(reply(page)).toHaveValue(DRAFT);
      expect(new URL(page.url()).searchParams.get("conversation")).toBe(ids.a);
      expect(await timeline.evaluate((element) => element.scrollTop)).toBe(scrollTop);
      expect(await threadReads(page)).toEqual(thread);
      if (viewport.width === 1440)
        await expect(listRow(page, "合成客戶甲")).toHaveAttribute("aria-current", "true");
    });
  });
}

test("重新整理 overtakes a background list read in flight, whose late answer is dropped", async ({
  page,
}) => {
  await open(page);
  const list = await listReads(page);
  await setFixture(page, { listMode: "pending" });

  await page.clock.runFor(POLL);
  await expect.poll(() => listReads(page)).toBe(list + 1);
  // The poll never shows a loading state, so 重新整理 stays available while it waits.
  await expect(refreshButton(page)).toBeEnabled();

  await setFixture(page, { listMode: "ok" });
  await pushInbound(page, ids.b, NEW_INBOUND);
  await refreshButton(page).click();
  await expect.poll(() => listReads(page)).toBe(list + 2);
  await expect(listRow(page, NEW_INBOUND)).toBeVisible();

  // The poll answers last, with the rows from before the new message: they are not applied.
  await releaseListReads(page);
  await nextTask(page);
  await expect(listRow(page, NEW_INBOUND)).toBeVisible();
  await expect(refreshButton(page)).toBeEnabled();
  await expect(refreshButton(page).locator(".animate-spin")).toHaveCount(0);
  await expectNoAlertOrToast(page);
});

test("a background list read that answers after the user paged leaves the new page", async ({
  page,
}) => {
  await open(page);
  await setFixture(page, { listPageSize: 1 });
  await refreshButton(page).click();
  const nextPage = page.getByRole("button", { name: "下一頁", exact: true });
  await expect(nextPage).toBeEnabled();
  const list = await listReads(page);

  await setFixture(page, { listMode: "pending" });
  await page.clock.runFor(POLL);
  await expect.poll(() => listReads(page)).toBe(list + 1);

  await setFixture(page, { listMode: "ok" });
  await nextPage.click();
  const olderPage = page.getByText("你正查看較舊頁面。按「第一頁」查看最新活動。");
  await expect(olderPage).toBeVisible();
  await expect(listRow(page, "合成客戶乙")).toBeVisible();

  // The poll was reading the first page; it answers after the user moved on and is dropped.
  await releaseListReads(page);
  await nextTask(page);
  await expect(olderPage).toBeVisible();
  await expect(listRow(page, "合成客戶乙")).toBeVisible();
  await expect(listRow(page, "合成客戶甲")).toHaveCount(0);
});

test("a list poll leaves 我的接手工作 alone, while 重新整理 still re-reads it", async ({
  page,
}) => {
  await open(page);
  const handoffs = page.getByRole("region", { name: "我的接手工作" });
  await expect(handoffs.getByText("此頁沒有你的接手工作。")).toBeVisible();
  await expect(handoffs.getByText(CHECKING_HANDOFFS)).toHaveCount(0);
  // Records whether the panel ever shows its "checking" line, however briefly.
  await page.evaluate((text) => {
    const w = window as unknown as FixtureWindow;
    w.__handoffChecking = false;
    new MutationObserver(() => {
      if (document.body.textContent?.includes(text)) w.__handoffChecking = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }, CHECKING_HANDOFFS);
  const updated = page.getByText(/^最後更新 /).filter({ visible: true });
  const updatedBefore = await updated.textContent();
  const reads = await handoffReads(page);
  const list = await listReads(page);

  await page.clock.runFor(POLL);
  await expect.poll(() => listReads(page)).toBe(list + 1);
  await nextTask(page);

  // The poll still moves 最後更新, but the handoff panel neither re-reads nor shows "checking".
  await expect(updated).not.toHaveText(updatedBefore!);
  expect(await handoffReads(page)).toBe(reads);
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__handoffChecking)).toBe(
    false,
  );

  // A moment later (so its 最後更新 differs from the poll's), 重新整理 re-reads the panel.
  await page.clock.runFor(1_000);
  await refreshButton(page).click();
  await expect.poll(() => handoffReads(page)).toBe(reads + 1);
});

test("a list poll clears the banner of a failed list read", async ({ page }) => {
  await open(page);
  await setFixture(page, { listMode: "failure" });
  await refreshButton(page).click();
  const banner = page.getByRole("alert").filter({ hasText: "合成對話列表讀取失敗" });
  await expect(banner).toBeVisible();

  await setFixture(page, { listMode: "ok" });
  await page.clock.runFor(POLL);
  await expect(banner).toHaveCount(0);
  await expectNoAlertOnPage(page);
});

test("a list poll keeps an error banner that did not come from a list read", async ({ page }) => {
  // The staff list read fails after the inbox list has loaded.
  await page.addInitScript(() => sessionStorage.setItem("no-link-fixture-agents", "error"));
  await open(page);
  await page.evaluate(() =>
    (window as unknown as FixtureWindow).noLinkFixture.pendingAgents
      .splice(0)
      .forEach((release) => release()),
  );
  const banner = page.getByRole("alert").filter({ hasText: "合成同事名單讀取失敗" });
  await expect(banner).toBeVisible();
  const list = await listReads(page);

  await page.clock.runFor(POLL);
  await expect.poll(() => listReads(page)).toBe(list + 1);
  await nextTask(page);
  await expect(banner).toBeVisible();
});

test("a failed background list read keeps the rows, raises nothing, and the next tick reads again", async ({
  page,
}) => {
  await open(page);
  const list = await listReads(page);
  await setFixture(page, { listMode: "failure" });

  await page.clock.runFor(POLL);
  await expect.poll(() => listReads(page)).toBe(list + 1);
  await nextTask(page);
  await expectNoAlertOnPage(page);
  await expect(listRow(page, "合成客戶甲")).toBeVisible();
  await expect(listRow(page, "合成客戶乙")).toBeVisible();
  await expect(refreshButton(page)).toBeEnabled();

  await page.clock.runFor(POLL);
  await expect.poll(() => listReads(page)).toBe(list + 2);
  await nextTask(page);
  await expectNoAlertOnPage(page);
});

test("a hung background list read is dropped after 30 s and the next tick reads again", async ({
  page,
}) => {
  await open(page);
  const list = await listReads(page);
  await setFixture(page, { listMode: "pending" });

  await page.clock.runFor(POLL);
  await expect.poll(() => listReads(page)).toBe(list + 1);

  // The read never answers: after 30 s it is given up, silently, with the list left as it was.
  await page.clock.runFor(30_000);
  await nextTask(page);
  await expectNoAlertOnPage(page);
  await expect(listRow(page, "合成客戶甲")).toBeVisible();
  await expect(refreshButton(page)).toBeEnabled();
  expect(await listReads(page)).toBe(list + 1);

  // ...so polling did not stall behind it: the next tick, a period after the first, reads again.
  await page.clock.runFor(POLL - 30_000);
  await expect.poll(() => listReads(page)).toBe(list + 2);
});
