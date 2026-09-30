/** Own loopback server; real route/components/CSS; synthetic Auth/API only. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium, expect } from "@playwright/test";

assert.ok(
  !process.env.PLAYWRIGHT_BASE_URL,
  "This runner owns its target; unset PLAYWRIGHT_BASE_URL",
);
const built = spawnSync(process.execPath, ["scripts/browser-fixtures/build-whatsapp-no-link.mjs"], {
  stdio: "inherit",
});
assert.equal(built.status, 0, "Real route fixture build failed");
const root = resolve(".audit/no-link-browser");
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    const target = path.startsWith("/assets/")
      ? resolve(root, `.${decodeURIComponent(path)}`)
      : resolve(root, "index.html");
    assert.ok(target.startsWith(root + sep), "Asset path escapes fixture root");
    response.setHeader(
      "Content-Type",
      { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" }[extname(target)] ??
        "application/octet-stream",
    );
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
    );
    response.end(await readFile(target));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const results = [];
let collected = 0;
const ids = {
  a: "10000000-0000-4000-8000-000000000001",
  b: "10000000-0000-4000-8000-000000000002",
  private: "10000000-0000-4000-8000-000000000003",
  staff: "20000000-0000-4000-8000-000000000001",
};
const url = (id) => `${origin}/admin/whatsapp${id ? `?conversation=${id}` : ""}`;
async function check(name, width, run, actor = "agent-a", height = 844) {
  collected++;
  if (
    process.env.NO_LINK_BROWSER_CHECK_FILTER &&
    !name.includes(process.env.NO_LINK_BROWSER_CHECK_FILTER)
  )
    return;
  const context = await browser.newContext({ viewport: { width, height } });
  const blocked = [],
    errors = [];
  await context.route("**/*", (route) => {
    const request = route.request();
    if (new URL(request.url()).origin === origin && ["GET", "HEAD"].includes(request.method()))
      return route.continue();
    blocked.push(request.method() + " " + new URL(request.url()).origin);
    return route.abort();
  });
  await context.addInitScript(
    (value) => sessionStorage.setItem("no-link-fixture-actor", value),
    actor,
  );
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await run(page);
    assert.deepEqual(blocked, [], "No remote or mutation network requests");
    assert.deepEqual(errors, [], "No browser runtime exceptions");
    const calls = await page.evaluate(() => window.noLinkFixture?.calls ?? []);
    assert.equal(
      calls.filter((c) =>
        [
          "sendReply",
          "sendTemplate",
          "updateConversation",
          "backfill",
          "consent",
          "confirmStaff",
          "staffHelp",
          "correctEnquiry",
        ].includes(c.name),
      ).length,
      0,
      "No mutation adapter calls",
    );
    results.push({ name, width, height, actor, status: "PASS" });
    if (name === "390px long timeline and composer")
      await page.screenshot({ path: ".audit/no-link-browser-390.png" });
    console.log(`PASS ${name}`);
  } catch (error) {
    if (await page.getByRole("button", { name: "Show Error" }).count()) {
      await page.getByRole("button", { name: "Show Error" }).click();
      console.error("Route error:", await page.locator("body").innerText());
    }
    await page.screenshot({ path: `.audit/no-link-browser-${results.length}.png`, fullPage: true });
    results.push({ name, width, height, actor, status: "FAIL", error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  } finally {
    await context.close();
  }
}
try {
  browser = await chromium.launch();
  await check("verified staff names replace ordinary UUIDs", 1280, async (page) => {
    await page.goto(url(ids.a));
    const evidence = page.getByRole("region", { name: "查詢及分派證據" });
    await expect(evidence).toContainText("已確認負責人：合成同事甲");
    await expect(evidence).toContainText("指定同事：合成同事甲");
    await expect(evidence).not.toContainText(ids.staff);
    await expect(evidence).toContainText("分派：已確認");
    await expect(evidence).not.toContainText("尚未執行自動分派");
    await page.getByText("支援診斷", { exact: true }).click();
    await expect(
      page.getByText(ids.staff, { exact: false }).filter({ visible: true }).first(),
    ).toBeVisible();
  });
  for (const width of [360, 390, 768, 1280]) {
    await check(`${width}px long timeline and composer`, width, async (page) => {
      await page.goto(url(ids.a));
      const input = page.getByLabel("WhatsApp 回覆").filter({ visible: true });
      await expect(input).toBeVisible();
      const last = await page.evaluate(() => window.noLinkFixture.lastMessage);
      await expect(page.getByText(last, { exact: true }).filter({ visible: true })).toBeVisible();
      if (width < 1024)
        await expect(
          page.getByText(last, { exact: true }).filter({ visible: true }),
        ).toBeInViewport({ ratio: 0.25 });
      await input.fill("合成草稿");
      await input.press("Enter");
      await expect(input).toHaveValue("合成草稿\n");
      const send = page.getByRole("button", { name: "傳送回覆", exact: true });
      await expect(send).toBeInViewport({ ratio: 1 });
      await expect(send).toBeEnabled();
      await page.reload();
      await expect(page.getByLabel("WhatsApp 回覆").filter({ visible: true })).toHaveValue(
        "合成草稿\n",
      );
      // Desktop keeps the normal document scroll; return to the workspace
      // before checking its composer after a reload.
      if (width >= 1024)
        await page.getByLabel("WhatsApp 回覆").filter({ visible: true }).scrollIntoViewIfNeeded();
      await expect(page.getByRole("button", { name: "傳送回覆", exact: true })).toBeInViewport({
        ratio: 1,
      });
    });
  }
  await check("second conversation keeps distinct drafts", 1280, async (page) => {
    await page.goto(url(ids.a));
    const input = page.getByLabel("WhatsApp 回覆").filter({ visible: true });
    await input.fill("甲盤草稿");
    await page.getByRole("button").filter({ hasText: "合成客戶乙" }).click();
    await expect(input).toHaveValue("");
    await input.fill("乙盤草稿");
    await page.getByRole("button").filter({ hasText: "合成客戶甲" }).click();
    await expect(input).toHaveValue("甲盤草稿");
    await page.reload();
    await expect(input).toHaveValue("甲盤草稿");
  });
  await check("pane resize preserves reading older messages", 390, async (page) => {
    await page.goto(url(ids.a));
    await expect(page.getByRole("region", { name: "查詢及分派證據" })).toContainText(
      "已確認負責人",
    );
    const lastText = await page.evaluate(() => window.noLinkFixture.lastMessage);
    const last = page.getByText(lastText, { exact: true }).filter({ visible: true });
    await expect(last).toBeInViewport({ ratio: 0.25 });
    const timeline = last.locator("xpath=ancestor::div[contains(@class,'overflow-y-auto')][1]");
    await timeline.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await page.setViewportSize({ width: 390, height: 740 });
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    await expect(last).not.toBeInViewport();
    expect(await timeline.evaluate((element) => element.scrollTop)).toBe(0);
  });
  await check("late detail response cannot replace next conversation", 1280, async (page) => {
    await page.goto(url());
    await expect(page.getByRole("button").filter({ hasText: "合成客戶甲" })).toBeVisible();
    await page.evaluate(() => {
      window.noLinkFixture.delayDetail = true;
    });
    await page.getByRole("button").filter({ hasText: "合成客戶甲" }).click();
    await expect
      .poll(() => page.evaluate(() => Boolean(window.noLinkFixture.releaseLateDetail)))
      .toBe(true);
    await page.getByRole("button").filter({ hasText: "合成客戶乙" }).click();
    await expect(page.getByRole("heading", { name: "合成客戶乙", exact: true })).toBeVisible();
    await page.getByLabel("WhatsApp 回覆").filter({ visible: true }).fill("乙盤保留草稿");
    await page.evaluate(() => window.noLinkFixture.releaseLateDetail());
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    await expect(page.getByRole("heading", { name: "合成客戶乙", exact: true })).toBeVisible();
    await expect(page.getByLabel("WhatsApp 回覆").filter({ visible: true })).toHaveValue(
      "乙盤保留草稿",
    );
  });
  await check("missing staff names stay unverified", 1280, async (page) => {
    await page.addInitScript(() => sessionStorage.setItem("no-link-fixture-names", "missing"));
    await page.goto(url(ids.a));
    const evidence = page.getByRole("region", { name: "查詢及分派證據" });
    await expect(evidence).toContainText("負責同事名稱待核實");
    await expect(evidence).toContainText("指定同事名稱待核實");
    await expect(evidence).not.toContainText(ids.staff);
  });
  await check("unknown assignment is not labelled confirmed", 1280, async (page) => {
    await page.addInitScript(() => sessionStorage.setItem("no-link-fixture-assignment", "unknown"));
    await page.goto(url(ids.a));
    await expect(page.getByRole("region", { name: "查詢及分派證據" })).toContainText(
      "分派：結果待核實",
    );
  });
  await check(
    "agent inbox navigation and external ID search retain admin boundary",
    1280,
    async (page) => {
      await page.goto(url());
      await expect(page.getByRole("link", { name: "WhatsApp 收件匣", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "WhatsApp 映射設定", exact: true })).toHaveCount(
        0,
      );
      await expect(page.getByRole("button", { name: "匯入歷史訊息", exact: true })).toHaveCount(0);
      const input = page.getByLabel("搜尋 WhatsApp 對話");
      await input.fill("4033349");
      await expect(page.getByRole("button").filter({ hasText: "合成客戶甲" })).toBeVisible();
      await expect(page.getByRole("button").filter({ hasText: "合成客戶乙" })).toHaveCount(0);
      await expect(page).toHaveURL(
        (value) => JSON.parse(value.searchParams.get("q") ?? "null") === "4033349",
      );
      await page.reload();
      await expect(input).toHaveValue("4033349");
    },
  );
  await check("mobile navigation closes on inbox entry", 390, async (page) => {
    await page.goto(url());
    await page.getByRole("button", { name: "開啟後台選單" }).click();
    await page.getByRole("link", { name: "WhatsApp 收件匣", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByLabel("搜尋 WhatsApp 對話")).toBeVisible();
  });
  await check("mobile detail escape retains filter and draft", 390, async (page) => {
    await page.goto(`${url(ids.a)}&q=4033349`);
    const input = page.getByLabel("WhatsApp 回覆").filter({ visible: true });
    await input.fill("手機草稿");
    await input.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByLabel("搜尋 WhatsApp 對話")).toHaveValue("4033349");
    await page.getByRole("button").filter({ hasText: "合成客戶甲" }).click();
    await expect(page.getByLabel("WhatsApp 回覆").filter({ visible: true })).toHaveValue(
      "手機草稿",
    );
  });
  await check(
    "short mobile viewport keeps send reachable",
    390,
    async (page) => {
      await page.goto(url(ids.a));
      await page.getByLabel("WhatsApp 回覆").filter({ visible: true }).fill("鍵盤模擬草稿");
      await expect(page.getByRole("button", { name: "傳送回覆", exact: true })).toBeInViewport();
    },
    "agent-a",
    500,
  );
  await check(
    "expired window shows empty template state and disables free reply",
    1280,
    async (page) => {
      await page.addInitScript(() => sessionStorage.setItem("no-link-fixture-window", "expired"));
      await page.goto(url(ids.a));
      await expect(page.getByLabel("WhatsApp 回覆").filter({ visible: true })).toBeDisabled();
      await expect(page.getByText(/目前未有已審批範本/).filter({ visible: true })).toBeVisible();
    },
  );
  await check("template error retry recovers without changing draft", 1280, async (page) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("no-link-fixture-window", "expired");
      sessionStorage.setItem("no-link-fixture-templates", "error");
      sessionStorage.setItem(
        "earnest:whatsapp:reply-drafts:agent-a",
        JSON.stringify({ "10000000-0000-4000-8000-000000000001": "保留草稿" }),
      );
    });
    await page.goto(url(ids.a));
    await expect(
      page.getByText("未能載入範本，請稍後重試。").filter({ visible: true }),
    ).toBeVisible();
    await page.evaluate(() => sessionStorage.removeItem("no-link-fixture-templates"));
    await page.getByRole("button", { name: "重新載入範本", exact: true }).click();
    await expect(page.getByText(/目前未有已審批範本/).filter({ visible: true })).toBeVisible();
    await expect(page.getByLabel("WhatsApp 回覆").filter({ visible: true })).toHaveValue(
      "保留草稿",
    );
  });
  await check(
    "other actor sees neither private thread nor composer",
    1280,
    async (page) => {
      await page.goto(url(ids.private));
      await expect(page.getByRole("alert").first()).toBeVisible();
      await expect(page.getByLabel("WhatsApp 回覆").filter({ visible: true })).toHaveCount(0);
      await expect(page.getByText("合成客戶甲", { exact: true })).toHaveCount(0);
    },
    "agent-b",
  );
  await check(
    "viewer shell denies staff UI",
    1280,
    async (page) => {
      await page.goto(url(ids.a));
      await expect(page.getByText("此帳戶不是職員帳戶", { exact: true })).toBeVisible();
      await expect(page.getByLabel("WhatsApp 回覆")).toHaveCount(0);
    },
    "viewer",
  );
  for (const value of ["true", '{"bad":"shape"}', "9007199254740993"]) {
    await check(`invalid JSON query does not crash: ${value}`, 1280, async (page) => {
      await page.goto(`${url(ids.a)}&q=${encodeURIComponent(value)}`);
      await expect(page.getByLabel("搜尋 WhatsApp 對話")).toHaveValue("");
      await expect(page.getByLabel("WhatsApp 回覆").filter({ visible: true })).toBeVisible();
    });
  }
  await check("synthetic composing Enter never invokes send", 390, async (page) => {
    await page.goto(url(ids.a));
    const input = page.getByLabel("WhatsApp 回覆").filter({ visible: true });
    await input.fill("香港繁中組字草稿");
    await input.dispatchEvent("compositionstart");
    await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
    await input.dispatchEvent("compositionend", { data: "稿" });
    await expect(input).toHaveValue("香港繁中組字草稿");
  });
  await check(
    "guest sees sign-in gate instead of staff inbox",
    1280,
    async (page) => {
      await page.goto(url(ids.a));
      await expect(page.getByRole("heading", { name: "職員登入", exact: true })).toBeVisible();
      await expect(page.getByLabel("WhatsApp 回覆")).toHaveCount(0);
    },
    "guest",
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  await mkdir(".audit", { recursive: true });
  await writeFile(
    ".audit/no-link-synthetic-browser-results.json",
    JSON.stringify(
      {
        environment: "real-route-synthetic-auth-api",
        codeSha: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
        browserVersion: browser?.version(),
        nodeVersion: process.version,
        collected,
        filtered: collected - results.length,
        providerSend: false,
        database: false,
        results,
      },
      null,
      2,
    ),
  );
}
const failed = results.filter((r) => r.status === "FAIL").length;
assert.ok(results.length > 0, "No browser checks executed");
console.log(
  JSON.stringify({
    collected,
    passed: results.length - failed,
    failed,
    skipped: collected - results.length,
  }),
);
if (failed) process.exitCode = 1;
