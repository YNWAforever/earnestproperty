import { test, expect, type Page } from "@playwright/test";
import { createAdminLayoutFixture } from "./admin-layout-fixture";
import { routeCases } from "../scripts/browser-fixtures/admin-layout/route-cases";
const fixture = createAdminLayoutFixture("layout");
type ScopeFixture = {
  dailyWorkFixture: {
    changeContext: (actor: string, role: string, binding?: string) => Promise<void>;
  };
  adminLayoutReads: {
    mode: string;
    hold: string[];
    pendingReads: { name: string; release: () => void }[];
  };
};
const changeScope = (page: Page, role: string, binding = "staff-a") =>
  page.evaluate(
    ({ role, binding }) =>
      (window as unknown as ScopeFixture).dailyWorkFixture.changeContext("actor-a", role, binding),
    { role, binding },
  );

test("SEC review command center drops private board on same-account downgrade", async ({
  page,
}) => {
  await fixture.open(page, { path: "/admin/leads/command-center" });
  await page.getByRole("button", { name: "合成跟進客戶", exact: true }).click();
  await changeScope(page, "agent");
  await expect(page.getByText("合成跟進客戶", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重新 AI 分析", exact: true })).toHaveCount(0);
});

test("SEC review transaction draft belongs to its staff binding", async ({ page }) => {
  await fixture.open(page, { path: "/admin/transactions/new" });
  const price = page.locator('input[name="price"]');
  await price.fill("8823456");
  await changeScope(page, "admin");
  await expect(price).toHaveValue("8823456");
  await changeScope(page, "admin", "staff-b");
  await expect(price).toHaveValue("");
});

for (const [path, state, retry, missing] of [
  [
    "/admin/transactions/70000000-0000-4000-8000-0000000000aa",
    "error:transaction",
    "重新載入成交",
    "找不到此成交記錄",
  ],
  [
    "/admin/agents/20000000-0000-4000-8000-000000000001",
    "error:agent-profile",
    "重新載入代理",
    "找不到代理資料",
  ],
])
  test(`READ review ${state} retries a failed record read separately`, async ({ page }) => {
    await fixture.open(page, { path, state });
    await expect(page.getByRole("alert").filter({ hasText: "未能載入" })).toBeVisible();
    await expect(page.locator("[data-admin-body]")).not.toContainText(missing);
    await page.evaluate(
      () => ((window as unknown as ScopeFixture).adminLayoutReads.mode = "normal"),
    );
    await page.getByRole("button", { name: retry, exact: true }).click();
    await expect(page.locator("[data-admin-body] form")).toBeVisible();
    await expect(page.getByRole("button", { name: retry, exact: true })).toHaveCount(0);
  });
const viewports = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];
export async function expectGeometry(page: Page, width: number, variant = "standard") {
  const content = page.locator("[data-admin-content]");
  await expect(content).toBeVisible();
  const bounds = await content.boundingBox();
  expect(bounds).not.toBeNull();
  const gutter = width < 768 ? 16 : width < 1280 ? 24 : 32;
  const rail = width >= 1024 ? 256 : 0;
  expect(Math.abs(bounds!.x - rail - gutter)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      bounds!.width -
        Math.min(
          width - rail - gutter * 2,
          variant === "form" ? 896 : variant === "wide" ? Infinity : 1440,
        ),
    ),
  ).toBeLessThanOrEqual(1);
  for (const selector of ["[data-admin-header]", "[data-admin-body]", "[data-admin-toolbar]"]) {
    for (const el of await page.locator(selector).all()) {
      const box = await el.boundingBox();
      if (!box) continue;
      expect(Math.abs(box.x - bounds!.x), selector + " left").toBeLessThanOrEqual(1);
      expect(Math.abs(box.width - bounds!.width), selector + " width").toBeLessThanOrEqual(1);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
}
for (const viewport of viewports)
  for (const item of routeCases) {
    const path = item.path;
    test(`normal ${path} ${viewport.width}`, async ({ page }) => {
      await fixture.open(page, { path, ...viewport });
      await expectGeometry(page, viewport.width, item.variant);
      if (item.route.endsWith("/new") || item.route.includes(":id")) {
        await expect(page.getByRole("navigation", { name: "麵包屑" })).toContainText("後台");
        await expect(page.locator("[data-admin-body] form").first()).toBeVisible();
      }
    });
  }
for (const width of [390, 768])
  test(`long title and wrapped actions ${width}`, async ({ page }) => {
    await fixture.open(page, { path: "/__layout-probe", width });
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    const title = page.getByRole("heading", { level: 1 });
    expect(
      await title.evaluate(
        (el) =>
          el.scrollWidth <= el.clientWidth + 1 && getComputedStyle(el).textOverflow !== "ellipsis",
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "第3個主要工作操作" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-clicked", "3");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  });
test("skip link reaches the focusable page content", async ({ page }) => {
  await fixture.open(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "跳至後台內容" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#admin-content")).toBeFocused();
});

for (const [path, label] of [
  ["/admin/agents/new", "中文名稱"],
  ["/admin/estates/new", "中文名"],
  ["/admin/transactions/new", "成交金額"],
])
  test(`editor draft survives collapse and cancelled breadcrumb ${path}`, async ({ page }) => {
    await fixture.open(page, { path });
    const input = path.includes("transactions")
      ? page.locator('input[name="price"]')
      : page.getByLabel(label, { exact: true });
    await input.fill(path.includes("transactions") ? "8800000" : "未儲存測試內容");
    const draft = await input.inputValue();
    await page.getByRole("button", { name: "收合後台選單" }).click();
    await expect(input).toHaveValue(draft);
    await page
      .getByRole("navigation", { name: "麵包屑" })
      .getByRole("link", { name: "後台", exact: true })
      .click();
    const prompt = page.getByRole("alertdialog", { name: "尚未儲存" });
    await expect(prompt).toBeVisible();
    await prompt.getByRole("button", { name: "取消", exact: true }).click();
    await expect(input).toHaveValue(draft);
  });

test("inbox uses the wide workspace on a large display", async ({ page }) => {
  await fixture.open(page, { path: "/admin/whatsapp", width: 2000, height: 1000 });
  await expect(page.getByRole("button").filter({ hasText: "合成客戶甲" })).toBeVisible();
  await expectGeometry(page, 2000, "wide");
});

test("inbox reply draft survives sidebar collapse and conversation A B A", async ({ page }) => {
  await fixture.open(page, { path: "/admin/whatsapp" });
  const select = (name: string) => page.getByRole("button").filter({ hasText: name }).click();
  await select("合成客戶甲");
  const reply = page.getByLabel("WhatsApp 回覆", { exact: true }).filter({ visible: true });
  await reply.fill("保留甲客戶草稿，尚未發送");
  await page.getByRole("button", { name: "收合後台選單" }).click();
  await expect(reply).toHaveValue("保留甲客戶草稿，尚未發送");
  await select("合成客戶乙");
  await expect(reply).toHaveValue("");
  await select("合成客戶甲");
  await expect(reply).toHaveValue("保留甲客戶草稿，尚未發送");
});

for (const role of ["agent", "viewer"] as const)
  for (const viewport of [viewports[0], viewports[2]])
    for (const item of routeCases.filter((item) =>
      (item.roles as readonly string[]).includes(role),
    ))
      test(`role geometry ${role} ${item.path} ${viewport.width}`, async ({ page }) => {
        await fixture.open(page, { role, path: item.path, ...viewport });
        await expectGeometry(page, viewport.width, item.variant);
      });

test("manager team read never exposes staff management actions", async ({ page }) => {
  await fixture.open(page, { role: "manager", path: "/admin/team" });
  await expect(page.getByText("受限合成團隊成員", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "邀請成員", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "受限合成團隊成員", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: /變更角色|停用帳戶|重設密碼/ })).toHaveCount(0);
});

for (const [path, target] of [
  ["/admin/leads/command-center?queue=unassigned", "/admin/leads/command-center"],
  [
    "/admin/whatsapp-settings?staffId=60000000-0000-4000-8000-000000000001&step=2",
    "/admin/whatsapp-settings",
  ],
  ["/admin/listings/A000001", "/admin/listings"],
  ["/admin/transactions/70000000-0000-4000-8000-0000000000aa", "/admin/transactions"],
])
  test(`deep link has exactly one active destination ${path}`, async ({ page }) => {
    await fixture.open(page, { path });
    const active = page.locator('aside [aria-current="page"]');
    await expect(active).toHaveCount(1);
    await expect(active).toHaveAttribute("href", target);
    const original = page.url();
    await page.locator("aside").getByRole("link", { name: "總覽", exact: true }).click();
    await page.goBack();
    await expect(page).toHaveURL(original);
    await expect(active).toHaveAttribute("href", target);
  });

test("mobile navigation has a 44px touch target", async ({ page }) => {
  await fixture.open(page, { width: 390 });
  const trigger = page.getByRole("button", { name: "開啟後台選單" });
  const box = await trigger.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

for (const [path, label] of [
  ["/admin/leads", "客戶查詢列表"],
  ["/admin/transactions", "成交列表"],
  ["/admin/estates", "屋苑清單"],
  ["/admin/blasts", "推廣活動清單"],
])
  test(`named table scroll region reaches the last column ${path}`, async ({ page }) => {
    await fixture.open(page, { path, width: 390 });
    const region = page.getByRole("region", { name: label, exact: true });
    await expect(region).toBeVisible();
    await region.focus();
    await expect(region).toBeFocused();
    expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await region.press("ArrowRight");
    await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await region.evaluate((el) => (el.scrollLeft = el.scrollWidth));
    const last = region.locator("tbody tr").first().locator("td").last();
    const cell = await last.boundingBox(),
      box = await region.boundingBox();
    expect(cell!.x + cell!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  });

for (const [tab, action] of [
  ["屋苑 SEO", "新增屋苑"],
  ["文章編輯", "新增文章"],
  ["YouTube影片", "新增影片"],
  ["FAQ 編輯", "新增 FAQ"],
])
  test(`CMS ${tab} keeps one reachable primary editor action`, async ({ page }) => {
    await fixture.open(page, { path: "/admin/cms", width: 390 });
    await page.getByRole("tab", { name: tab, exact: true }).click();
    const button = page.getByRole("button", { name: action, exact: true });
    await expect(button).toHaveCount(1);
    await button.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const cancel = dialog.getByRole("button", { name: /取消|關閉/, exact: true }).first();
    await cancel.scrollIntoViewIfNeeded();
    await expect(cancel).toBeInViewport();
    await cancel.click();
    await expect(dialog).not.toBeVisible();
  });

for (const item of routeCases)
  test(`error state ${item.path}`, async ({ page }) => {
    await fixture.open(page, { path: item.path, width: 390, state: "error" });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { adminLayoutReads: { failures: string[] } }).adminLayoutReads
              .failures.length,
        ),
      )
      .toBeGreaterThan(0);
    await expect(page.locator("[data-admin-body]")).toContainText(/失敗|未能|重試|錯誤|讀取/);
    await expectGeometry(page, 390, item.variant);
  });
for (const path of [
  "/admin",
  "/admin/leads",
  "/admin/leads/command-center",
  "/admin/whatsapp",
  "/admin/listings",
  "/admin/transactions",
  "/admin/blasts",
  "/admin/cms",
  "/admin/estates",
  "/admin/segments",
  "/admin/team",
  "/admin/agents",
])
  test(`empty state ${path}`, async ({ page }) => {
    await fixture.open(page, { path, width: 390, state: "empty" });
    await expectGeometry(page, 390, path === "/admin/whatsapp" ? "wide" : "standard");
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { adminLayoutReads: { failures: string[] } }).adminLayoutReads
            .failures,
      ),
    ).toEqual([]);
    await expect(page.locator("[data-admin-body]")).toContainText(/未有|沒有|找不到|0|建立|新增/);
  });
for (const [path, label, value] of [
  ["/admin/listings/new", "標題 *", "保留中的樓盤標題"],
  ["/admin/transactions/new", "成交金額", "8800000"],
  ["/admin/estates/new", "中文名", "保留中的屋苑名稱"],
])
  test(`read retry preserves editor draft ${path}`, async ({ page }) => {
    await fixture.open(page, { path, width: 390, state: "error" });
    const field = path.includes("transactions")
      ? page.locator('input[name="price"]')
      : page.getByLabel(label, { exact: true });
    await field.fill(value);
    await expect(page.getByRole("alert").filter({ hasText: "未能載入" }).first()).toBeVisible();
    await page.evaluate(
      () =>
        ((window as unknown as { adminLayoutReads: { mode: string } }).adminLayoutReads.mode =
          "normal"),
    );
    await page.getByRole("button", { name: "重新載入選項", exact: true }).click();
    await expect(page.getByRole("button", { name: "重新載入選項", exact: true })).toHaveCount(0);
    await expect(field).toHaveValue(value);
  });

for (const [path, retry] of [
  ["/admin/estates/70000000-0000-4000-8000-000000000001", "重新載入屋苑"],
  ["/admin/agents/new", "重新載入編輯權限"],
  ["/admin/agents/20000000-0000-4000-8000-000000000001", "重新載入編輯權限"],
])
  test(`editor read failure recovers without a false missing-record state ${path}`, async ({
    page,
  }) => {
    await fixture.open(page, { path, width: 390, state: "error" });
    await expect(page.locator("[data-admin-body]")).not.toContainText(
      /找不到代理資料|找不到此屋苑資料/,
    );
    await page.getByRole("button", { name: retry, exact: true }).click();
    await expect(page.getByRole("button", { name: retry, exact: true })).toBeEnabled();
    await page.evaluate(
      () =>
        ((window as unknown as { adminLayoutReads: { mode: string } }).adminLayoutReads.mode =
          "normal"),
    );
    await page.getByRole("button", { name: retry, exact: true }).click();
    await expect(page.locator("[data-admin-body] form").first()).toBeVisible();
    await expect(page.getByRole("button", { name: retry, exact: true })).toHaveCount(0);
  });
for (const role of ["agent", "viewer"])
  test(`operations omits unauthorized service health ${role}`, async ({ page }) => {
    await fixture.open(page, { path: "/admin/operations", role, state: "empty" });
    await expect(page.getByRole("region", { name: "WhatsApp 服務健康" })).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { adminLayoutReads: { reads: string[] } }).adminLayoutReads.reads,
      ),
    ).not.toContain("fetchWhatsappServiceHealth");
  });

const reviewedPaths = routeCases.filter(
  ({ route }) =>
    /^\/admin\/(agents|estates|transactions|cms|segments)(\/|$)/.test(route) ||
    route.endsWith("command-center"),
);
for (const item of reviewedPaths)
  test(`SEC review viewer downgrade unmounts the private workspace ${item.path}`, async ({
    page,
  }) => {
    await fixture.open(page, { path: item.path });
    await changeScope(page, "viewer");
    await expect(page.locator("[data-admin-body]").getByRole("status")).toHaveText(
      "目前沒有此頁的存取權限，請從後台選單選擇可用工作。",
    );
    await expect(
      page.locator("[data-admin-body] table, [data-admin-body] input, [data-admin-body] textarea"),
    ).toHaveCount(0);
    await expect(page.locator("[data-admin-body] form")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

for (const [path, selector, value] of [
  ["/admin/agents/new", "#name_zh", "另一員工不可見的草稿"],
  ["/admin/agents/20000000-0000-4000-8000-000000000001", "#name_zh", "另一員工不可見的草稿"],
  ["/admin/estates/new", "#name_zh", "另一員工不可見的草稿"],
  ["/admin/estates/70000000-0000-4000-8000-000000000001", "#name_zh", "另一員工不可見的草稿"],
  ["/admin/transactions/70000000-0000-4000-8000-0000000000aa", 'input[name="price"]', "8823456"],
])
  test(`SEC review unchanged identity keeps draft and rebind resets ${path}`, async ({ page }) => {
    await fixture.open(page, { path });
    const field = page.locator(selector);
    await expect(field).toBeVisible();
    const initial = await field.inputValue();
    await field.fill(value);
    await changeScope(page, "admin");
    await expect(field).toHaveValue(value);
    await changeScope(page, "admin", "staff-b");
    await expect(field).toHaveValue(initial);
  });

for (const path of ["/admin/agents/new", "/admin/agents/20000000-0000-4000-8000-000000000001"])
  test(`SEC review agent editor refreshes the server capability ${path}`, async ({ page }) => {
    await fixture.open(page, { path });
    await expect(page.getByLabel("Neon Auth 使用者 ID", { exact: true })).toBeVisible();
    await changeScope(page, "manager");
    await expect(page.getByLabel("中文名稱", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Neon Auth 使用者 ID", { exact: true })).toHaveCount(0);
    await changeScope(page, "admin");
    await expect(page.getByLabel("Neon Auth 使用者 ID", { exact: true })).toBeVisible();
  });

for (const [path, readName, privateText] of [
  ["/admin/leads/command-center", "command-center", "合成跟進客戶"],
  ["/admin/cms", "page", "合成屋苑"],
  ["/admin/agents", "agent-profiles", "合成代理甲"],
  ["/admin/estates", "cms", "合成屋苑"],
  ["/admin/segments", "segments", "合成客戶分群"],
  ["/admin/transactions", "transactions", "合成屋苑"],
  ["/admin/agents/20000000-0000-4000-8000-000000000001", "agent-profile", "合成代理甲"],
  ["/admin/estates/70000000-0000-4000-8000-000000000001", "fetchAdminCmsEditor", "合成屋苑"],
  ["/admin/transactions/70000000-0000-4000-8000-0000000000aa", "transaction", "合成屋苑"],
])
  test(`SEC review delayed ${readName} cannot repopulate a rebound workspace`, async ({ page }) => {
    await fixture.open(page, { path, state: `hold:${readName}` });
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as ScopeFixture).adminLayoutReads.pendingReads.length,
        ),
      )
      .toBeGreaterThan(0);
    await page.evaluate((readName) => {
      const reads = (window as unknown as ScopeFixture).adminLayoutReads;
      reads.hold = [];
      reads.mode = `error:${readName}`;
    }, readName);
    await changeScope(page, "admin", "staff-b");
    await expect(page.locator("[data-admin-body]")).toContainText(/失敗|未能/);
    await page.evaluate(() =>
      (window as unknown as ScopeFixture).adminLayoutReads.pendingReads
        .slice()
        .forEach((read) => read.release()),
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as ScopeFixture).adminLayoutReads.pendingReads.length,
        ),
      )
      .toBe(0);
    await expect(page.locator("[data-admin-body]")).not.toContainText(privateText);
    if (/\/[^/]+\/[\da-f-]{36}$/.test(path))
      await expect(page.locator("[data-admin-body] form")).toHaveCount(0);
  });
