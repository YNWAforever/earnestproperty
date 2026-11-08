import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Page, type Route } from "@playwright/test";

type DraftSave = { resourceType: string; resourceId?: string; payload: Record<string, unknown> };
type Fixture = { saves: unknown[]; editorReads: number; draftSaves: DraftSave[] };
declare global {
  interface Window {
    leaveGuardFixture: Fixture;
    copilotFixture: typeof import("../scripts/browser-fixtures/leave-guards/synthetic-copilot").copilotFixture;
    blogFixture: typeof import("../scripts/browser-fixtures/leave-guards/synthetic-blog").fixture;
  }
}

// FX-17a G-20: the real TransactionForm and CMS dialogs, mounted on their real routes with
// in-memory ports. A leave guard must fire for unsaved work, must never fire for work that was
// just saved or never touched, and must ask again for an edit made after a save.
let server: Server, origin: string;
test.beforeAll(async () => {
  assert.ok(!process.env.PLAYWRIGHT_BASE_URL);
  assert.equal(
    spawnSync(process.execPath, ["scripts/browser-fixtures/build-admin-leave-guards.mjs"], {
      stdio: "inherit",
    }).status,
    0,
  );
  const root = resolve(".audit/leave-guards-browser");
  server = createServer(async (request, response) => {
    try {
      assert.ok(["GET", "HEAD"].includes(request.method!));
      const path = new URL(request.url!, "http://127.0.0.1").pathname;
      const target = path.startsWith("/assets/")
        ? resolve(root, `.${decodeURIComponent(path)}`)
        : resolve(root, "index.html");
      assert.ok(target.startsWith(root + sep));
      response.setHeader(
        "Content-Type",
        (
          { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" } as Record<
            string,
            string
          >
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
test.use({ viewport: { width: 1440, height: 900 } });

const EDIT = "/admin/transactions/70000000-0000-4000-8000-0000000000aa";
const prompt = (page: Page) => page.getByRole("alertdialog", { name: "尚未儲存" });
const arrived = (page: Page) => page.getByRole("heading", { name: "離開後的頁面" });
const sidebarLink = (page: Page) =>
  page.locator('nav[aria-label="後台選單"] a[href="/admin/leads"]');
// With a Radix dialog open the sidebar is inert to the pointer, so a real click cannot reach it:
// fire the link's own click. Used only while a CMS dialog is open.
const clickBehindDialog = (page: Page) =>
  sidebarLink(page).evaluate((link) => (link as HTMLElement).click());
const saveCount = (page: Page) => page.evaluate(() => window.leaveGuardFixture.saves.length);
const draftSaves = (page: Page) => page.evaluate(() => window.leaveGuardFixture.draftSaves);

async function open(page: Page, path: string) {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin &&
    ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort(),
  );
  await page.goto(origin + path);
}

test.describe("transaction form", () => {
  test("a clean form lets staff leave without a prompt", async ({ page }) => {
    await open(page, EDIT);
    await expect(page.locator("#price")).toHaveValue("8500000");
    await sidebarLink(page).click();
    await expect(arrived(page)).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);
  });

  test("an edit asks 尚未儲存; cancelling stays, 離開並放棄修改 leaves", async ({ page }) => {
    await open(page, EDIT);
    await expect(page.locator("#price")).toHaveValue("8500000");
    await page.locator("#price").fill("9000000");
    await sidebarLink(page).click();
    await expect(prompt(page)).toBeVisible();
    await prompt(page).getByRole("button", { name: "取消" }).click();
    await expect(prompt(page)).toHaveCount(0);
    await expect(page.locator("#price")).toHaveValue("9000000");
    await sidebarLink(page).click();
    await prompt(page).getByRole("button", { name: "離開並放棄修改" }).click();
    await expect(arrived(page)).toBeVisible();
  });

  test("browser back from a dirty new transaction asks, and confirming goes back", async ({
    page,
  }) => {
    await open(page, "/admin/leads");
    await page.getByRole("link", { name: "新增成交（測試連結）" }).click();
    await page.locator("#price").fill("123");
    await page.goBack();
    await expect(prompt(page)).toBeVisible();
    await prompt(page).getByRole("button", { name: "離開並放棄修改" }).click();
    await expect(arrived(page)).toBeVisible();
  });

  test("saving a new transaction opens the saved record with no prompt", async ({ page }) => {
    await open(page, "/admin/transactions/new");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "合成屋苑" }).click();
    await page.locator("#price").fill("8000000");
    await page.locator("#saleable_area").fill("500");
    await page.locator("#deal_date").fill("2026-06-01");
    await page.getByRole("button", { name: "建立成交" }).click();
    await expect(page).toHaveURL(/\/admin\/transactions\/70000000-0000-4000-8000-0000000000bb$/);
    await expect(prompt(page)).toHaveCount(0);
    expect(await saveCount(page)).toBe(1);
    // The record that opened is clean: leaving it is free.
    await sidebarLink(page).click();
    await expect(arrived(page)).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);
  });

  test("after a save on the edit page, a later edit is guarded again", async ({ page }) => {
    await open(page, EDIT);
    await expect(page.locator("#price")).toHaveValue("8500000");
    await page.locator("#price").fill("9100000");
    await page.getByRole("button", { name: "更新成交" }).click();
    await expect.poll(() => saveCount(page)).toBe(1);
    await page.locator("#unit").fill("Z9");
    await sidebarLink(page).click();
    await expect(prompt(page)).toBeVisible();
    await prompt(page).getByRole("button", { name: "取消" }).click();
    // Putting the field back to the saved value makes the form clean again.
    await page.locator("#unit").fill("A");
    await sidebarLink(page).click();
    await expect(arrived(page)).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);
  });
});

test.describe("CMS dialogs", () => {
  test("a saved FAQ closes its dialog and leaving the page is not blocked", async ({ page }) => {
    await open(page, "/admin/cms?tab=faqs");
    await page.getByRole("button", { name: "新增 FAQ" }).first().click();
    await page.locator("form").getByLabel("問題", { exact: true }).fill("合成問題");
    await page.locator("form").getByLabel("答案", { exact: true }).fill("合成答案");
    await page.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await saveCount(page)).toBe(1);
    await sidebarLink(page).click();
    await expect(arrived(page)).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);
  });

  test("an unsaved FAQ asks on leaving the page; confirming leaves", async ({ page }) => {
    await open(page, "/admin/cms?tab=faqs");
    await page.getByRole("button", { name: "新增 FAQ" }).first().click();
    await page.locator("form").getByLabel("問題", { exact: true }).fill("寫了一半");
    await clickBehindDialog(page);
    await expect(prompt(page)).toBeVisible();
    await prompt(page).getByRole("button", { name: "離開並放棄修改" }).click();
    await expect(arrived(page)).toBeVisible();
  });

  test("opening an estate and waiting for it to load stays clean", async ({ page }) => {
    await open(page, "/admin/cms?tab=estates");
    await page.getByRole("button", { name: "編輯", exact: true }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.leaveGuardFixture.editorReads))
      .toBeGreaterThan(0);
    await page.waitForTimeout(300);
    await clickBehindDialog(page);
    await expect(arrived(page)).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);
  });

  // The draft save's `{data}` goes through the server's strict cmsDraftSaveSchema in the
  // fixture, so a key the hub adds or renames fails here, in the browser, not only in a unit test.
  for (const { tab, label, value, field } of [
    { tab: "estates", label: "發展商", value: "合成發展商", field: "developer" },
    { tab: "articles", label: "標題", value: "修改後合成文章", field: "title" },
  ])
    test(`a ${tab} draft save passes the strict schema and leaves the page unguarded`, async ({
      page,
    }) => {
      await open(page, `/admin/cms?tab=${tab}`);
      await page.getByRole("button", { name: /^編輯/ }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => window.leaveGuardFixture.editorReads))
        .toBeGreaterThan(0);
      await dialog.getByLabel(label, { exact: true }).fill(value);
      await expect(dialog.getByRole("status")).toHaveText("有未儲存修改");
      await dialog.getByRole("button", { name: "儲存草稿" }).click();
      await expect(page.getByText("草稿已儲存")).toBeVisible();
      await expect(dialog.getByRole("status")).toHaveText("目前內容已儲存");
      const saved = await draftSaves(page);
      expect(saved).toHaveLength(1);
      expect(saved[0].resourceType).toBe(tab === "estates" ? "estate" : "article");
      expect(saved[0].payload[field]).toBe(value);
      // Saved work is not unsaved work: leaving neither prompts nor loses anything.
      await clickBehindDialog(page);
      await expect(arrived(page)).toBeVisible();
      await expect(prompt(page)).toHaveCount(0);
    });
});

test.describe("Task6 blog editor fixture", () => {
  const blog = (page: Page) => page.locator('section[aria-label="網誌管理"]');
  const editor = (page: Page) => page.getByRole("dialog", { name: "文章編輯", exact: true });
  async function admin(page: Page) {
    await page.addInitScript(() => sessionStorage.setItem("blog-fixture-role", "admin"));
  }
  test("101st article, full search/category/state pagination and locked slug", async ({ page }) => {
    await open(page, "/admin/cms?tab=articles");
    for (let i = 0; i < 4; i++)
      await blog(page).getByRole("button", { name: "下一頁文章" }).click();
    await expect(blog(page).getByText("共 101 篇 · 第 5 / 5 頁")).toBeVisible();
    await blog(page).getByRole("button", { name: "編輯 合成文章 101", exact: true }).click();
    await expect(editor(page).getByLabel("網址代稱（Slug）")).toHaveAttribute("readonly", "");
    await expect(editor(page).getByText("現有網址已鎖定。", { exact: true })).toBeVisible();
    await editor(page).getByLabel("標題", { exact: true }).fill("尚未儲存 101");
    await editor(page).getByRole("button", { name: "關閉", exact: true }).first().click();
    await expect(prompt(page)).toBeVisible();
    await prompt(page).getByRole("button", { name: "取消" }).click();
    await expect(editor(page).getByLabel("標題", { exact: true })).toHaveValue("尚未儲存 101");
    await editor(page).getByRole("button", { name: "儲存草稿" }).click();
    await expect(editor(page).getByText("草稿已儲存", { exact: true })).toBeVisible();
    await editor(page).getByRole("button", { name: "關閉", exact: true }).first().click();
    await blog(page).getByLabel("搜尋標題、slug 或分類").fill("尚未儲存 101");
    await expect(blog(page).getByText("共 1 篇 · 第 1 / 1 頁")).toBeVisible();
    await blog(page).getByLabel("搜尋標題、slug 或分類").fill("");
    await blog(page).getByLabel("文章狀態").selectOption("published");
    await expect(blog(page).getByText("共 50 篇 · 第 1 / 2 頁")).toBeVisible();
    await blog(page).getByRole("button", { name: "編輯 合成文章 2", exact: true }).click();
    await expect(editor(page).getByLabel("網址代稱（Slug）")).toHaveAttribute("readonly", "");
    await expect(editor(page).getByText("現有網址已鎖定。", { exact: true })).toBeVisible();
    await editor(page).getByRole("button", { name: "關閉", exact: true }).first().click();
    await blog(page).getByLabel("文章分類").selectOption({ label: "買樓" });
    await expect(blog(page).getByText("共 0 篇 · 第 1 / 1 頁")).toBeVisible();
  });
  test("agent never requests admin state or sees publication/settings controls", async ({
    page,
  }) => {
    await open(page, "/admin/cms?tab=articles");
    await blog(page).getByRole("button", { name: "編輯 合成文章 1", exact: true }).click();
    await expect(editor(page).getByRole("button", { name: "發布", exact: true })).toHaveCount(0);
    await expect(blog(page).getByRole("button", { name: "網誌設定" })).toHaveCount(0);
    expect(
      await page.evaluate(() => ({
        state: window.blogFixture.stateReads,
        options: window.blogFixture.optionReads,
      })),
    ).toEqual({ state: 0, options: 1 });
  });
  test("create identity/CAS survives failed list refresh, retry updates same article and reload persists", async ({
    page,
  }) => {
    await open(page, "/admin/cms?tab=articles");
    await blog(page).getByRole("button", { name: "新增文章" }).click();
    const dialog = page.getByRole("dialog", { name: "新增文章", exact: true });
    await dialog.getByLabel("標題", { exact: true }).fill("新草稿");
    await dialog.getByLabel("網址代稱（Slug）").fill("new-fixture");
    await page.evaluate(() => {
      window.blogFixture.afterSaveFailList = true;
    });
    await dialog.getByRole("button", { name: "儲存草稿" }).click();
    await expect(editor(page).getByText(/內容已儲存，但清單更新失敗/)).toBeVisible();
    await editor(page).getByLabel("標題", { exact: true }).fill("第二次修改");
    await editor(page).getByRole("button", { name: "儲存草稿" }).click();
    await expect.poll(() => page.evaluate(() => window.blogFixture.commands.length)).toBe(2);
    const commands = await page.evaluate(() => window.blogFixture.commands);
    expect(commands[0].id).toBeUndefined();
    expect(commands[1].id).toBeTruthy();
    expect(commands[1].editState?.resourceId).toBe(commands[1].id);
    expect(commands[1].editState?.draftEditVersion).toBe(1);
    await expect(editor(page).getByRole("status")).toHaveText("目前內容已儲存");
    await expect(editor(page).getByText(/內容已儲存，但清單更新失敗/)).toBeVisible();
    await page.evaluate(() => {
      window.blogFixture.failList = false;
      window.blogFixture.afterSaveFailList = false;
    });
    await editor(page).getByRole("button", { name: "重試載入清單" }).click();
    await expect(editor(page).getByText("清單已更新")).toBeVisible();
    await editor(page).getByRole("button", { name: "關閉", exact: true }).first().click();
    await page.reload();
    await blog(page).getByLabel("搜尋標題、slug 或分類").fill("第二次修改");
    await expect(blog(page).getByText("共 1 篇 · 第 1 / 1 頁")).toBeVisible();
  });
  test("409 preserves typed text; 503 reports a server failure; failed reads never become empty", async ({
    page,
  }) => {
    await open(page, "/admin/cms?tab=articles");
    await blog(page).getByRole("button", { name: "編輯 合成文章 1", exact: true }).click();
    await editor(page).getByLabel("標題", { exact: true }).fill("不可以遺失");
    await page.evaluate(() => {
      window.blogFixture.failSave = 409;
    });
    await editor(page).getByRole("button", { name: "儲存草稿" }).click();
    await expect(editor(page).getByRole("alert")).toContainText("資料版本已改變");
    await expect(editor(page).getByLabel("標題", { exact: true })).toHaveValue("不可以遺失");
    await page.evaluate(() => {
      window.blogFixture.failSave = 503;
    });
    await editor(page).getByRole("button", { name: "儲存草稿" }).click();
    // 503 is the server, not the edit: the copy must say the edit was NOT saved.
    // It used to say "修改已保留…重試會沿用相同操作編號", which claimed a save outcome
    // the request never established and hid the 2026-11-06 outage behind a retry
    // prompt. The typed text still has to survive, and the retry still has to reuse
    // the same operation id — that is the receipt contract, and it is unchanged.
    const alert = editor(page).getByRole("alert");
    await expect(alert).toContainText("並沒有儲存");
    await expect(alert).not.toContainText("修改已保留");
    await expect(editor(page).getByLabel("標題", { exact: true })).toHaveValue("不可以遺失");
    await editor(page).getByRole("button", { name: "儲存草稿" }).click();
    const commands = await page.evaluate(() => window.blogFixture.commands);
    expect(commands[1].requestId).toBe(commands[2].requestId);
    await page.evaluate(() => {
      window.blogFixture.failSave = 0;
    });
    await editor(page).getByRole("button", { name: "儲存草稿" }).click();
    await expect(editor(page).getByText("草稿已儲存", { exact: true })).toBeVisible();
  });
  test("explicit publish, affected placements on reassignment and confirmed unpublish", async ({
    page,
  }) => {
    await admin(page);
    await open(page, "/admin/cms?tab=articles");
    await blog(page).getByRole("button", { name: "編輯 合成文章 1", exact: true }).click();
    await editor(page).getByRole("button", { name: "發布", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "確認發布", exact: true })
      .click();
    await expect(editor(page).getByText("文章已更新發布", { exact: true })).toBeVisible();
    await editor(page).getByRole("button", { name: "關閉", exact: true }).first().click();
    await blog(page).getByRole("button", { name: "編輯 合成文章 2", exact: true }).click();
    await editor(page).getByLabel("分類", { exact: true }).selectOption({ label: "買樓" });
    await editor(page).getByRole("button", { name: "更新已發布文章" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("成交分析");
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "確認發布", exact: true })
      .click();
    await expect(editor(page).getByText("文章已更新發布", { exact: true })).toBeVisible();
    await editor(page).getByRole("button", { name: "取消發布", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toContainText("網誌首頁");
    await page.getByRole("alertdialog").getByRole("button", { name: "取消", exact: true }).click();
    await expect(editor(page).getByRole("button", { name: "更新已發布文章" })).toBeVisible();
    await editor(page).getByRole("button", { name: "取消發布", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "確認取消發布" }).click();
    await expect(editor(page).getByText("文章已取消發布", { exact: true })).toBeVisible();
  });
  test("actual Tiptap literal conversion, metadata/refs and supplemental links survive save and preview", async ({
    page,
  }) => {
    await open(page, "/admin/cms?tab=articles");
    await blog(page).getByRole("button", { name: "編輯 合成文章 1", exact: true }).click();
    const d = editor(page);
    const literal = "  <script>literal</script>\n\n最後一行  ";
    await d.getByLabel("內容", { exact: true }).fill(literal);
    await d.getByRole("button", { name: "轉換為格式編輯（保留原文字）" }).click();
    await expect(d.getByRole("textbox", { name: "文章內容", exact: true })).toContainText(
      "<script>literal</script>",
    );
    await d.getByLabel("作者", { exact: true }).fill("新作者");
    await d.getByLabel("比較屋苑代稱（每行一個）").fill("sea-crest\nocean-pointe");
    await d.getByRole("button", { name: "新增延伸閱讀" }).click();
    await d.getByLabel("連結 1 標題").fill("詳情");
    await d.getByLabel("連結 1 網址").fill("/about");
    await d.getByRole("button", { name: "儲存草稿" }).click();
    await expect(d.getByText("草稿已儲存", { exact: true })).toBeVisible();
    const c = await page.evaluate(() => window.blogFixture.commands.at(-1)!);
    expect(c.input.editorial.compareEstateSlugs).toEqual(["sea-crest", "ocean-pointe"]);
    expect(c.input.body.format).toBe("editor-json-v1");
    if (c.input.body.format === "editor-json-v1")
      expect(c.input.body.document).toMatchObject({
        content: [{ type: "paragraph", content: [{ type: "text", text: literal }] }],
      });
    await d.getByRole("button", { name: "預覽已儲存內容" }).click();
    await expect(d.getByRole("region", { name: "已儲存文章預覽" })).toContainText(
      "<script>literal</script>",
    );
    await expect(
      d.getByRole("region", { name: "已儲存文章預覽" }).getByRole("link", { name: "詳情" }),
    ).toHaveAttribute("href", "/about");
  });
  test("narrow keyboard ordering, independent copy/features, dirty navigation and immutable category key", async ({
    page,
  }) => {
    await admin(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "/admin/cms?tab=articles");
    await blog(page).getByRole("button", { name: "網誌設定", exact: true }).click();
    await blog(page).getByRole("button", { name: "網誌首頁", exact: true }).click();
    await blog(page).getByLabel("頁面標題").fill("獨立首頁標題");
    const down = blog(page).getByRole("button", { name: "下移第 1 篇" });
    await down.focus();
    await page.keyboard.press("Enter");
    await blog(page).getByRole("button", { name: "儲存網誌設定" }).click();
    await expect(blog(page).getByRole("status")).toHaveText("目前內容已儲存");
    const s = await page.evaluate(() => window.blogFixture.settings());
    expect(s[0].heading).toBe("獨立首頁標題");
    expect(s[0].featuredIds[0]).toMatch(/000004$/);
    expect(s[1].heading).toBe("合成頁面標題");
    expect(s[1].featuredIds[0]).toMatch(/000002$/);
    await blog(page).getByLabel("介紹").fill("尚未儲存介紹");
    await blog(page).getByRole("button", { name: "分類管理", exact: true }).click();
    await expect(prompt(page)).toBeVisible();
    await prompt(page).getByRole("button", { name: "取消", exact: true }).click();
    await expect(blog(page).getByLabel("介紹")).toHaveValue("尚未儲存介紹");
    await blog(page).getByRole("button", { name: "分類管理", exact: true }).click();
    await prompt(page).getByRole("button", { name: "放棄修改", exact: true }).click();
    await blog(page).getByRole("button", { name: "編輯分類 成交分析" }).click();
    await expect(blog(page).getByLabel("分類網址鍵")).toHaveAttribute("readonly", "");
    await blog(page).getByLabel("分類名稱").fill("改名成交");
    await blog(page).getByRole("button", { name: "儲存分類" }).click();
    await expect(blog(page).getByRole("status")).toHaveText("目前內容已儲存");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: ".superpowers/sdd/2026-11-05-blog-cms-implementation/test-logs/task-6-narrow.png",
      fullPage: true,
    });
  });
});

test.describe("Task6 delayed operations", () => {
  test("switching away during an article read never opens its late editor", async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem("blog-fixture-role", "admin"));
    await open(page, "/admin/cms?tab=articles");
    await page.evaluate(() => {
      window.blogFixture.previewDelayMs = 500;
    });
    await page.getByRole("button", { name: "編輯 合成文章 1", exact: true }).click();
    await page.getByRole("button", { name: "網誌設定", exact: true }).click();
    await expect(page.getByText("選擇獨立頁面設定")).toBeVisible();
    await page.waitForTimeout(650);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
  test("pending save locks rich input; upload failure retains text and cannot publish a draft", async ({
    page,
  }) => {
    await open(page, "/admin/cms?tab=articles");
    await page.getByRole("button", { name: "編輯 合成文章 1", exact: true }).click();
    const d = page.getByRole("dialog", { name: "文章編輯", exact: true });
    await d.getByRole("button", { name: "轉換為格式編輯（保留原文字）" }).click();
    const body = d.getByRole("textbox", { name: "文章內容", exact: true });
    await body.fill("保留的格式內容");
    await page.evaluate(() => {
      window.blogFixture.saveDelayMs = 600;
    });
    await d.getByRole("button", { name: "儲存草稿" }).click();
    await expect(body).toHaveAttribute("contenteditable", "false");
    await expect(d.getByLabel("標題", { exact: true })).toBeDisabled();
    await expect(d.getByRole("status")).toHaveText("目前內容已儲存");
    await expect(body).toHaveAttribute("contenteditable", "true");
    await d.getByLabel("標題", { exact: true }).fill("上載失敗仍保留");
    await page.route("**/api/admin/media/upload", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "UPLOAD_OUTCOME_UNKNOWN" }),
      }),
    );
    await d.getByLabel("上載封面圖片").setInputFiles({
      name: "fixture.png",
      mimeType: "image/png",
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    await expect(d.getByRole("alert")).toContainText("其他修改已保留");
    await expect(d.getByLabel("標題", { exact: true })).toHaveValue("上載失敗仍保留");
    await expect(body).toHaveText("保留的格式內容");
    await expect(d.getByRole("button", { name: "發布", exact: true })).toHaveCount(0);
  });
});

test("Task6 manager review preserves own tokens; restore confirms and installs returned identity before refresh failure", async ({
  page,
}) => {
  await page.addInitScript(() => sessionStorage.setItem("blog-fixture-role", "manager"));
  await open(page, "/admin/cms?tab=articles");
  await page.getByRole("button", { name: "編輯 合成文章 2", exact: true }).click();
  const d = page.getByRole("dialog", { name: "文章編輯", exact: true });
  const original = await page.evaluate(() => window.blogFixture.records()[1].editState);
  await d.getByLabel("指定草稿版本編號").fill("70000000-0000-4000-8000-000000009999");
  await d.getByRole("button", { name: "審閱指定草稿", exact: true }).click();
  await expect(d.getByRole("region", { name: "指定草稿審閱" })).toContainText("其他作者的草稿");
  await d.getByRole("button", { name: "採用審閱內容" }).click();
  await expect(d.getByLabel("標題", { exact: true })).toHaveValue("指定草稿內容");
  await d.getByRole("button", { name: "更新已發布文章" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "確認發布", exact: true })
    .click();
  await expect(d.getByText("文章已更新發布", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.blogFixture.commands[0].editState)).toEqual(original);
  await d.getByLabel("標題", { exact: true }).fill("待放棄修改");
  await d.getByRole("button", { name: "還原 v1", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("未儲存");
  await page.getByRole("alertdialog").getByRole("button", { name: "取消", exact: true }).click();
  await expect(d.getByLabel("標題", { exact: true })).toHaveValue("待放棄修改");
  await page.evaluate(() => {
    window.blogFixture.failList = true;
  });
  await d.getByRole("button", { name: "還原 v1", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "還原", exact: true }).click();
  await expect(d.getByText(/新草稿已還原，清單更新失敗。/)).toBeVisible();
  await expect(d.getByLabel("內容", { exact: true })).toHaveValue("歷史純文字 <b>不轉成 HTML</b>");
  await page.evaluate(() => {
    window.blogFixture.failList = false;
  });
  await d.getByLabel("標題", { exact: true }).fill("還原後修改");
  await d.getByRole("button", { name: "更新已發布文章" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "確認發布", exact: true })
    .click();
  await expect(d.getByText("文章已更新發布", { exact: true })).toBeVisible();
  const last = await page.evaluate(() => window.blogFixture.commands.at(-1)!);
  expect(last.editState?.restoredFromRevisionId).toBe("70000000-0000-4000-8000-000000003002");
  expect(last.editState?.draftRevisionId).not.toBe(original.draftRevisionId);
});

test("Task6 explicit reload replaces rich text after a conflict", async ({ page }) => {
  await open(page, "/admin/cms?tab=articles");
  await page.getByRole("button", { name: "編輯 合成文章 1", exact: true }).click();
  const d = page.getByRole("dialog", { name: "文章編輯", exact: true });
  await d.getByRole("button", { name: "轉換為格式編輯（保留原文字）" }).click();
  const body = d.getByRole("textbox", { name: "文章內容", exact: true });
  await body.fill("已儲存文字");
  await d.getByRole("button", { name: "儲存草稿" }).click();
  await expect(d.getByText("草稿已儲存", { exact: true })).toBeVisible();
  await body.fill("尚未儲存的文字");
  await page.evaluate(() => {
    window.blogFixture.failSave = 409;
  });
  await d.getByRole("button", { name: "儲存草稿" }).click();
  await expect(d.getByRole("alert")).toContainText("資料版本已改變");
  page.once("dialog", (dialog) => dialog.accept());
  await d.getByRole("button", { name: "重新載入文章", exact: true }).click();
  await expect(body).toHaveText("已儲存文字");
  await expect(d.getByRole("status")).toHaveText("目前內容已儲存");
});

const editor = (page: Page) => page.getByRole("dialog", { name: "文章編輯", exact: true });
const blog = (page: Page) => page.locator('section[aria-label="網誌管理"]');

test.describe("Task6 supplement", () => {
  test("existing article assistance is available without saving or publishing", async ({
    page,
  }) => {
    await open(page, "/admin/cms?tab=articles");
    await page.getByRole("button", { name: "編輯 合成文章 1", exact: true }).click();
    await page.getByText("AI 內容建議", { exact: true }).click();
    await expect(page.getByRole("complementary", { name: "AI 內容助手" })).toBeVisible();
    expect(await page.evaluate(() => window.blogFixture.commands)).toEqual([]);
  });
  test("selected off-page article titles load independently of the picker", async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem("blog-fixture-role", "admin"));
    await page.addInitScript(() => sessionStorage.setItem("blog-fixture-offpage", "yes"));
    await open(page, "/admin/cms?tab=articles");

    await page.getByRole("button", { name: "網誌設定", exact: true }).click();
    await page.getByRole("button", { name: "網誌首頁", exact: true }).click();
    await expect(page.locator("ol")).toContainText("合成文章 100");
    await expect(page.locator("ol")).not.toContainText("70000000-");
  });
});

test.describe("Task6 supplement copilot", () => {
  const panel = (page: Page) => page.getByRole("complementary", { name: "AI 內容助手" });
  async function start(page: Page) {
    await open(page, "/admin/cms?tab=articles");
    await page.getByRole("button", { name: "編輯 合成文章 1", exact: true }).click();
    await page.getByText("AI 內容建議", { exact: true }).click();
  }
  test("explicit selected fields, failed decision retry, undo and CAS remain local until save", async ({
    page,
  }) => {
    await start(page);
    const d = editor(page),
      p = panel(page);
    await d.getByLabel("作者", { exact: true }).fill("未儲存作者");
    const original = await page.evaluate(() => window.blogFixture.records()[0]);
    await p.getByRole("button", { name: "產生建議", exact: true }).click();
    await expect(p.getByRole("button", { name: "套用已選建議（0）" })).toBeDisabled();
    await p.getByRole("checkbox", { name: "套用 標題", exact: true }).check();
    await page.evaluate(() => {
      window.copilotFixture.failDecision = true;
    });
    await p.getByRole("button", { name: "套用已選建議（1）" }).click();
    await expect(p.getByRole("alert")).toBeVisible();
    await expect(d.getByLabel("標題", { exact: true })).toHaveValue(original.title);
    await expect(d.getByLabel("作者", { exact: true })).toHaveValue("未儲存作者");
    await page.evaluate(() => {
      window.copilotFixture.failDecision = false;
    });
    await p.getByRole("button", { name: "套用已選建議（1）" }).click();
    await expect(d.getByLabel("標題", { exact: true })).toHaveValue("建議標題");
    await expect(d.getByLabel("內容", { exact: true })).toHaveValue(
      original.body.format === "legacy-text" ? original.body.text : "",
    );
    expect(await page.evaluate(() => window.blogFixture.commands.length)).toBe(0);
    await p.getByRole("button", { name: "復原為套用前內容" }).click();
    await expect(d.getByLabel("標題", { exact: true })).toHaveValue(original.title);
    await expect(d.getByLabel("作者", { exact: true })).toHaveValue("未儲存作者");
    await d.getByRole("button", { name: "儲存草稿", exact: true }).click();
    await expect(d.getByText("草稿已儲存", { exact: true })).toBeVisible();
    const command = await page.evaluate(() => window.blogFixture.commands.at(-1)!);
    expect(command.editState).toEqual(original.editState);
    expect(command.expectedVersion).toBe(original.version);
    expect(command.action).toBe("save");
    expect(command.input.published).toBe(false);
    expect(command.input.editorial.compareEstateSlugs).toEqual(
      original.editorial.compareEstateSlugs,
    );
  });
  test("failed and pending generation retains edits and rejects stale apply", async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("copilot-fail-generate", "yes");
      sessionStorage.setItem("copilot-delay", "600");
    });
    await start(page);
    const d = editor(page),
      p = panel(page);
    await p.getByRole("button", { name: "產生建議", exact: true }).click();
    await d.getByLabel("作者", { exact: true }).fill("生成期間修改");
    await expect(p.getByRole("alert")).toBeVisible();
    await expect(d.getByLabel("作者", { exact: true })).toHaveValue("生成期間修改");
    await page.evaluate(() => {
      window.copilotFixture.failGenerate = false;
    });
    await p.getByRole("button", { name: "產生建議", exact: true }).click();
    await d.getByLabel("標題", { exact: true }).fill("保留手動標題");
    await expect(p.getByText("表單已改動，此建議已過時。", { exact: true })).toBeVisible();
    await p.getByRole("checkbox", { name: "套用 標題", exact: true }).check();
    await expect(p.getByRole("button", { name: "套用已選建議（1）" })).toBeDisabled();
    await expect(d.getByLabel("標題", { exact: true })).toHaveValue("保留手動標題");
    expect(await page.evaluate(() => window.blogFixture.commands.length)).toBe(0);
  });
  test("edits during pending apply cannot be overwritten or auto-published", async ({ page }) => {
    await start(page);
    const d = editor(page),
      p = panel(page);
    await p.getByRole("button", { name: "產生建議", exact: true }).click();
    await p.getByRole("checkbox", { name: "套用 標題", exact: true }).check();
    await page.evaluate(() => {
      window.copilotFixture.decisionDelayMs = 700;
    });
    await p.getByRole("button", { name: "套用已選建議（1）" }).click();
    await expect(p.getByRole("button", { name: "套用中…" })).toBeVisible();
    await d.getByLabel("標題", { exact: true }).fill("決定期間手動修改");
    await expect(p.getByRole("alert")).toBeVisible();
    await expect(d.getByLabel("標題", { exact: true })).toHaveValue("決定期間手動修改");
    expect(await page.evaluate(() => window.blogFixture.commands.length)).toBe(0);
  });
  test("rich suggestion is literal, explicit undo restores marks media links and unsaved metadata", async ({
    page,
  }) => {
    await open(page, "/admin/cms?tab=articles");
    await page.evaluate(() => {
      const a = window.blogFixture.records()[0];
      a.body = {
        format: "editor-json-v1",
        document: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: "原標題", marks: [{ type: "bold" }] }],
            },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "原連結",
                  marks: [{ type: "link", attrs: { href: "/about" } }],
                },
              ],
            },
            {
              type: "image",
              attrs: {
                src: "/fixture-image.png",
                alt: "原圖片",
                title: "保留圖片",
                width: 200,
                height: 100,
              },
            },
          ],
        },
      };
      a.links = [{ href: "/about", label: "延伸來源" }];
    });
    await page.getByRole("button", { name: "編輯 合成文章 1", exact: true }).click();
    await page.getByText("AI 內容建議", { exact: true }).click();
    const d = editor(page),
      p = panel(page);
    const original = await page.evaluate(() => window.blogFixture.records()[0]);
    await d.getByLabel("作者", { exact: true }).fill("本地作者");
    await p.getByRole("button", { name: "產生建議", exact: true }).click();
    await p.getByRole("checkbox", { name: "套用 內容", exact: true }).check();
    await p.getByRole("button", { name: "套用已選建議（1）" }).click();
    await expect(p.getByRole("button", { name: "套用中…" })).toHaveCount(0);
    expect(await p.getByRole("alert").allTextContents()).toEqual([]);
    await expect(d.getByRole("textbox", { name: "文章內容", exact: true })).toContainText(
      "<b>建議文字</b>",
    );
    await p.getByRole("button", { name: "復原為套用前內容" }).click();
    await expect(
      d
        .getByRole("textbox", { name: "文章內容", exact: true })
        .getByRole("heading", { name: "原標題" }),
    ).toBeVisible();
    await d.getByRole("button", { name: "儲存草稿", exact: true }).click();
    await expect(d.getByText("草稿已儲存", { exact: true })).toBeVisible();
    const command = await page.evaluate(() => window.blogFixture.commands.at(-1)!);
    expect(command.input.body).toEqual(original.body);
    expect(command.input.links).toEqual(original.links);
    expect(command.input.editorial.author).toBe("本地作者");
    expect(command.editState).toEqual(original.editState);
    expect(command.input.published).toBe(false);
  });
});

test("Task6 supplement title hydration failure retries without dropping selection or exposing IDs", async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("blog-fixture-role", "admin");
    sessionStorage.setItem("blog-fixture-offpage", "yes");
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/admin/cms?tab=articles");
  await page.evaluate(() => {
    window.blogFixture.failPreviewIds = [window.blogFixture.records()[99].id];
  });
  await page.getByRole("button", { name: "網誌設定", exact: true }).click();
  await page.getByRole("button", { name: "網誌首頁", exact: true }).click();
  await expect(page.locator("ol")).toContainText("未能載入第 1 篇文章標題");
  await expect(page.locator("ol")).not.toContainText("70000000-");
  await blog(page).getByLabel("頁面標題").fill("保留獨立標題");
  await page.evaluate(() => {
    window.blogFixture.failPreviewIds = [];
  });
  await page.getByRole("button", { name: "重試第 1 篇標題" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("ol")).toContainText("合成文章 100");
  await expect(blog(page).getByLabel("頁面標題")).toHaveValue("保留獨立標題");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: ".superpowers/sdd/2026-11-05-blog-cms-implementation/test-logs/task-6-supplement-narrow.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "下移第 1 篇" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "儲存網誌設定" }).click();
  await expect(blog(page).getByRole("status")).toHaveText("目前內容已儲存");
  expect(await page.evaluate(() => window.blogFixture.settings()[0].featuredIds)).toEqual([
    "70000000-0000-4000-8000-000000000002",
    "70000000-0000-4000-8000-000000000100",
  ]);
});

test("Task6 supplement published article suggestions require a separate publication action", async ({
  page,
}) => {
  await page.addInitScript(() => sessionStorage.setItem("blog-fixture-role", "admin"));
  await open(page, "/admin/cms?tab=articles");
  await page.getByRole("button", { name: "編輯 合成文章 2", exact: true }).click();
  const before = await page.evaluate(() => window.blogFixture.records()[1]);
  await page.getByText("AI 內容建議", { exact: true }).click();
  const p = page.getByRole("complementary", { name: "AI 內容助手" });
  await p.getByRole("button", { name: "產生建議", exact: true }).click();
  await p.getByRole("checkbox", { name: "套用 標題", exact: true }).check();
  await p.getByRole("button", { name: "套用已選建議（1）" }).click();
  await expect(editor(page).getByLabel("標題", { exact: true })).toHaveValue("建議標題");
  expect(await page.evaluate(() => window.blogFixture.records()[1])).toEqual(before);
  expect(await page.evaluate(() => window.blogFixture.commands)).toEqual([]);
  await editor(page).getByRole("button", { name: "關閉", exact: true }).first().click();
  await expect(prompt(page)).toBeVisible();
  await prompt(page).getByRole("button", { name: "取消", exact: true }).click();
  await expect(editor(page).getByLabel("標題", { exact: true })).toHaveValue("建議標題");
  await expect(editor(page).getByRole("button", { name: "更新已發布文章" })).toBeVisible();
});

test.describe("Task6 round1", () => {
  test("delayed reload locks editing save and close; failed read retains unsaved input", async ({
    page,
  }) => {
    await open(page, "/admin/cms?tab=articles");
    await page.getByRole("button", { name: "編輯 合成文章 1", exact: true }).click();
    const d = editor(page);
    await d.getByRole("button", { name: "轉換為格式編輯（保留原文字）" }).click();
    await d.getByRole("button", { name: "儲存草稿", exact: true }).click();
    await expect(d.getByText("草稿已儲存", { exact: true })).toBeVisible();
    await d.getByRole("textbox", { name: "文章內容", exact: true }).fill("未儲存正文");
    await d.getByLabel("標題", { exact: true }).fill("未儲存標題");
    await page.evaluate(() => {
      window.blogFixture.failSave = 409;
    });
    await d.getByRole("button", { name: "儲存草稿", exact: true }).click();
    await expect(d.getByRole("alert")).toContainText("資料版本已改變");
    await page.evaluate(() => {
      window.blogFixture.previewDelayMs = 700;
      window.blogFixture.failPreviewIds = [window.blogFixture.records()[0].id];
    });
    page.once("dialog", (dialog) => dialog.accept());
    await d.getByRole("button", { name: "重新載入文章", exact: true }).click();
    await expect(d.getByLabel("標題", { exact: true })).toBeDisabled();
    await expect(d.getByRole("textbox", { name: "文章內容", exact: true })).toHaveAttribute(
      "contenteditable",
      "false",
    );
    await expect(d.getByRole("button", { name: "儲存草稿", exact: true })).toBeDisabled();
    await expect(d.getByRole("button", { name: "關閉", exact: true }).first()).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(d).toBeVisible();
    await expect(d.getByLabel("標題", { exact: true })).toBeEnabled();
    await expect(d.getByLabel("標題", { exact: true })).toHaveValue("未儲存標題");
    await expect(d.getByRole("textbox", { name: "文章內容", exact: true })).toHaveText(
      "未儲存正文",
    );
    await expect(d.getByRole("status")).toHaveText("有未儲存修改");
    await page.evaluate(() => {
      window.blogFixture.failPreviewIds = [];
    });
    page.once("dialog", (dialog) => dialog.accept());
    await d.getByRole("button", { name: "重新載入文章", exact: true }).click();
    await expect(d.getByLabel("標題", { exact: true })).toBeDisabled();
    await expect(d.getByRole("status")).toHaveText("目前內容已儲存");
    await d.getByLabel("標題", { exact: true }).fill("載入後新修改");
    await expect(d.getByRole("status")).toHaveText("有未儲存修改");
    expect(await page.evaluate(() => window.blogFixture.commands.length)).toBe(2);
  });
  for (const first of ["cover", "inline"] as const)
    test(`overlapping uploads keep guards until both complete: ${first} first`, async ({
      page,
    }) => {
      await open(page, "/admin/cms?tab=articles");
      await page.getByRole("button", { name: "編輯 合成文章 1", exact: true }).click();
      const d = editor(page);
      await d.getByRole("button", { name: "轉換為格式編輯（保留原文字）" }).click();
      await d.getByText("內文圖片", { exact: true }).click();
      const pending: Route[] = [];
      await page.route("**/api/admin/media/upload", (route) => {
        pending.push(route);
      });
      const file = (name: string) => ({
        name,
        mimeType: "image/png",
        buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      });
      await d.getByLabel("上載封面圖片").setInputFiles(file("cover.png"));
      await expect.poll(() => pending.length).toBe(1);
      await d.getByLabel("上載內文圖片").setInputFiles(file("inline.png"));
      await expect.poll(() => pending.length).toBe(2);
      await d.getByLabel("標題", { exact: true }).fill("並行上載保留文字");
      const index = first === "cover" ? 0 : 1;
      await pending[index].fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, url: "/first.png" }),
      });
      await expect(d.getByLabel(first === "cover" ? "上載封面圖片" : "上載內文圖片")).toBeEnabled();
      await expect(d.getByRole("button", { name: "儲存草稿", exact: true })).toBeDisabled();
      await expect(d.getByRole("button", { name: "關閉", exact: true }).first()).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(d).toBeVisible();
      await pending[1 - index].fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "UPLOAD_OUTCOME_UNKNOWN" }),
      });
      await expect(d.getByRole("button", { name: "儲存草稿", exact: true })).toBeEnabled();
      await expect(d.getByLabel("標題", { exact: true })).toHaveValue("並行上載保留文字");
      await expect(d.getByRole("alert")).toContainText("其他修改已保留");
      expect(await page.evaluate(() => window.blogFixture.commands)).toEqual([]);
    });
  for (const published of [true, false])
    test(`restore keeps freshly loaded publication state before next save: published=${published}`, async ({
      page,
    }) => {
      await page.addInitScript(() => sessionStorage.setItem("blog-fixture-role", "manager"));
      await open(page, "/admin/cms?tab=articles");
      await page.evaluate((published) => {
        const a = window.blogFixture.records()[1];
        a.version = 9;
        a.published = published;
        a.editState.currentPublishedVersion = published ? 9 : null;
        a.editState.basePublishedVersion = published ? 9 : null;
        window.blogFixture.failList = true;
      }, published);
      await page.getByRole("button", { name: "編輯 合成文章 2", exact: true }).click();
      const d = editor(page);
      await d.getByRole("button", { name: "還原 v1", exact: true }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "還原", exact: true })
        .click();
      await expect(d.getByText(/新草稿已還原，清單更新失敗。/)).toBeVisible();
      await expect(d.getByLabel("內容", { exact: true })).toHaveValue(
        "歷史純文字 <b>不轉成 HTML</b>",
      );
      const restored = await page.evaluate(() => window.blogFixture.records()[1]);
      await expect(d.getByRole("button", { name: "取消發布", exact: true })).toHaveCount(
        published ? 1 : 0,
      );
      await d.getByLabel("標題", { exact: true }).fill("還原後正確版本");
      await page.evaluate(() => {
        window.blogFixture.failList = false;
      });
      await d
        .getByRole("button", { name: published ? "更新已發布文章" : "儲存草稿", exact: true })
        .click();
      if (published)
        await page
          .getByRole("alertdialog")
          .getByRole("button", { name: "確認發布", exact: true })
          .click();
      await expect(
        d.getByText(published ? "文章已更新發布" : "草稿已儲存", { exact: true }),
      ).toBeVisible();
      const last = await page.evaluate(() => window.blogFixture.commands.at(-1)!);
      expect(last.expectedVersion).toBe(9);
      expect(last.editState).toEqual(restored.editState);
      expect(last.input.published).toBe(published);
    });
});

test("Task6 round1 restore read failure retains receipt and retries read without restoring twice", async ({
  page,
}) => {
  await page.addInitScript(() => sessionStorage.setItem("blog-fixture-role", "manager"));
  await open(page, "/admin/cms?tab=articles");
  await page.evaluate(() => {
    const a = window.blogFixture.records()[1];
    a.version = 9;
    a.published = false;
    a.editState.currentPublishedVersion = null;
    a.editState.basePublishedVersion = null;
    window.blogFixture.failRestoreRead = true;
  });
  await page.getByRole("button", { name: "編輯 合成文章 2", exact: true }).click();
  const d = editor(page);
  await d.getByRole("button", { name: "還原 v1", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "還原", exact: true }).click();
  await expect(
    d.getByText("草稿已還原，但未能確認最新發布狀態。請重新載入文章後繼續；無需再次還原。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(d.getByRole("button", { name: "同步後才可儲存" })).toBeDisabled();
  await expect(d.getByLabel("標題", { exact: true })).toBeDisabled();
  await expect(d.getByRole("button", { name: "取消發布", exact: true })).toHaveCount(0);
  await expect(d.getByLabel("內容", { exact: true })).toHaveValue("歷史純文字 <b>不轉成 HTML</b>");
  const restored = await page.evaluate(() => window.blogFixture.records()[1]);
  await page.evaluate(() => {
    window.blogFixture.failPreviewIds = [];
  });
  page.once("dialog", (dialog) => dialog.accept());
  await d.getByRole("button", { name: "重新載入文章", exact: true }).click();
  await expect(d.getByRole("button", { name: "儲存草稿", exact: true })).toBeEnabled();
  await d.getByLabel("標題", { exact: true }).fill("讀取重試後修改");
  await d.getByRole("button", { name: "儲存草稿", exact: true }).click();
  await expect(d.getByText("草稿已儲存", { exact: true })).toBeVisible();
  const result = await page.evaluate(() => ({
    count: window.blogFixture.restoreCalls,
    command: window.blogFixture.commands.at(-1)!,
  }));
  expect(result.count).toBe(1);
  expect(result.command.expectedVersion).toBe(9);
  expect(result.command.editState).toEqual(restored.editState);
  expect(result.command.input.published).toBe(false);
});

test.describe("Final fix", () => {
  test("explicit reconciliation retains unsaved content and submits checked fresh public tokens", async ({
    page,
  }) => {
    await open(page, "/admin/cms?tab=articles");
    await page.getByRole("button", { name: "編輯 合成文章 1", exact: true }).click();
    const d = editor(page);
    await d.getByLabel("標題", { exact: true }).fill("作者未儲存內容");
    await page.evaluate(() => {
      const a = window.blogFixture.records()[0];
      a.version = 7;
      a.published = true;
      a.editState.currentPublishedVersion = 7;
    });
    await d.getByRole("button", { name: "儲存草稿", exact: true }).click();
    await expect(d.getByRole("alert")).toContainText("資料版本已改變");
    await d.getByRole("button", { name: "核對最新版本並保留我的內容" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("目前發布版本：7");
    await confirm.getByRole("button", { name: "確認保留我的內容" }).click();
    await expect(d.getByText("已保留你的內容並更新草稿基準；請核對後再發布。")).toBeVisible();
    await expect(d.getByLabel("標題", { exact: true })).toHaveValue("作者未儲存內容");
    const command = await page.evaluate(() => window.blogFixture.commands.at(-1)!);
    expect(command.action).toBe("reconcile");
    expect(command.editState!.currentPublishedVersion).toBe(7);
    expect(command.editState!.basePublishedVersion).toBeNull();
    expect(command.input.title).toBe("作者未儲存內容");
  });
  test("reconciliation rejects another tab's draft and a publication changed during confirmation", async ({
    page,
  }) => {
    await open(page, "/admin/cms?tab=articles");
    await page.getByRole("button", { name: "編輯 合成文章 1", exact: true }).click();
    const d = editor(page);
    await d.getByLabel("標題", { exact: true }).fill("不可丟失");
    await d.getByRole("button", { name: "核對最新版本並保留我的內容" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.evaluate(() => {
      window.blogFixture.records()[0].editState.currentPublishedVersion = 9;
    });
    await page.getByRole("alertdialog").getByRole("button", { name: "確認保留我的內容" }).click();
    await expect(d.getByRole("alert")).toContainText("資料版本已改變");
    await expect(d.getByLabel("標題", { exact: true })).toHaveValue("不可丟失");
    await page.evaluate(() => {
      window.blogFixture.records()[0].editState.draftEditVersion = 8;
    });
    await d.getByRole("button", { name: "核對最新版本並保留我的內容" }).click();
    await expect(d.getByRole("alert")).toContainText("另一分頁已修改草稿");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(await page.evaluate(() => window.blogFixture.commands.length)).toBe(1);
  });
  test("restore confirmation cannot retire a draft saved by another tab", async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem("blog-fixture-role", "manager"));
    await open(page, "/admin/cms?tab=articles");
    await page.getByRole("button", { name: "編輯 合成文章 2", exact: true }).click();
    const d = editor(page);
    await d.getByLabel("標題", { exact: true }).fill("本地修改");
    await d.getByRole("button", { name: "還原 v1", exact: true }).click();
    await page.evaluate(() => {
      const a = window.blogFixture.records()[1];
      a.title = "另一分頁新草稿";
      a.editState.draftEditVersion = 2;
    });
    await page.getByRole("alertdialog").getByRole("button", { name: "還原", exact: true }).click();
    await expect(page.getByRole("alertdialog").getByRole("alert")).toContainText("資料版本已改變");
    await page.getByRole("alertdialog").getByRole("button", { name: "取消", exact: true }).click();
    expect(await page.evaluate(() => window.blogFixture.records()[1].title)).toBe("另一分頁新草稿");
    await expect(d.getByLabel("標題", { exact: true })).toHaveValue("本地修改");
  });
  test("new draft slug stays editable, collision preserves form, rename saves", async ({
    page,
  }) => {
    await open(page, "/admin/cms?tab=articles");
    await page.getByRole("button", { name: "新增文章", exact: true }).click();
    const d = page.getByRole("dialog", { name: "新增文章", exact: true });
    await d.getByLabel("網址代稱（Slug）").fill("fixture-1");
    await d.getByLabel("標題", { exact: true }).fill("新稿");
    await d.getByRole("button", { name: "儲存草稿", exact: true }).click();
    await expect(d.getByRole("alert")).toContainText("內容未通過檢查");
    await d.getByLabel("網址代稱（Slug）").fill("unique-new-draft");
    await d.getByRole("button", { name: "儲存草稿", exact: true }).click();
    const saved = editor(page);
    await expect(saved.getByText("草稿已儲存", { exact: true })).toBeVisible();
    await expect(saved.getByLabel("網址代稱（Slug）")).toBeEditable();
    await expect(saved.getByText("現有網址已鎖定。", { exact: true })).toHaveCount(0);
    await saved.getByLabel("網址代稱（Slug）").fill("renamed-before-publication");
    await saved.getByRole("button", { name: "儲存草稿", exact: true }).click();
    await expect(saved.getByRole("status")).toHaveText("目前內容已儲存");
    expect(await page.evaluate(() => window.blogFixture.commands.at(-1)!.input.slug)).toBe(
      "renamed-before-publication",
    );
  });
  test("category blank heading saves and reserved key is rejected", async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem("blog-fixture-role", "manager"));
    await open(page, "/admin/cms?tab=articles");
    await page.getByRole("button", { name: "分類管理", exact: true }).click();
    await page.getByRole("button", { name: "編輯分類 成交分析" }).click();
    await page.getByLabel("頁面標題", { exact: true }).fill("");
    await page.getByRole("button", { name: "儲存分類" }).click();
    await expect(page.getByRole("status")).toHaveText("目前內容已儲存");
    await page.getByRole("button", { name: "返回分類", exact: true }).click();
    await page.getByRole("button", { name: "新增分類" }).click();
    await page.getByLabel("分類名稱").fill("不能使用");
    await page.getByLabel("分類網址鍵").fill("全部");
    await page.getByRole("button", { name: "儲存分類" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("分類名稱")).toHaveValue("不能使用");
  });
});
