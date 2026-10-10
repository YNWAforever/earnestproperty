/** Own loopback server; real route/components/CSS; synthetic Auth/API only. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium, expect } from "@playwright/test";
const evidencePrefix = process.env.EARNEST_BROWSER_EVIDENCE_PREFIX ?? "";
if (!/^[a-z0-9-]*$/.test(evidencePrefix)) throw Error("Invalid owned evidence prefix");

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
      {
        ".js": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".woff2": "font/woff2",
      }[extname(target)] ?? "application/octet-stream",
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
const renderedControls = new Map();
let collected = 0;
const ids = {
  a: "10000000-0000-4000-8000-000000000001",
  b: "10000000-0000-4000-8000-000000000002",
  private: "10000000-0000-4000-8000-000000000003",
  staff: "20000000-0000-4000-8000-000000000001",
};
const url = (id) => `${origin}/admin/whatsapp${id ? `?conversation=${id}` : ""}`;
async function open(page, target) {
  await page.goto(target);
  await page.evaluate(() => document.fonts.ready);
}
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
  await context.addInitScript((value) => {
    if (!sessionStorage.getItem("no-link-fixture-actor"))
      sessionStorage.setItem("no-link-fixture-actor", value);
  }, actor);
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
          "contactEdit",
          "leadAi",
          "approveTag",
          "rejectTag",
          "leadActivity",
          "bulkLeads",
          "updateLead",
        ].includes(c.name),
      ).length,
      0,
      "No mutation adapter calls",
    );
    // Observed controls are inventory candidates. A passed scenario does not
    // assert that every visible control was operated or is production-ready.
    const controls = await page
      .locator("button,a,input,textarea,select,[role='tab'],[role='combobox']")
      .evaluateAll((elements) =>
        elements
          .filter(
            (element) =>
              element.getClientRects().length && getComputedStyle(element).visibility !== "hidden",
          )
          .map((element) => ({
            role:
              element.getAttribute("role") ||
              ({
                BUTTON: "button",
                A: "link",
                INPUT: "input",
                TEXTAREA: "textbox",
                SELECT: "combobox",
              }[element.tagName] ??
                element.tagName.toLowerCase()),
            name: (
              element.getAttribute("aria-label") ||
              element.labels?.[0]?.textContent ||
              element.innerText ||
              element.getAttribute("placeholder") ||
              element.getAttribute("title") ||
              ""
            )
              .trim()
              .slice(0, 160),
            disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
          })),
      );
    const path = new URL(page.url()).pathname;
    for (const control of controls) {
      const key = JSON.stringify([path, actor, control.role, control.name]);
      const record = renderedControls.get(key) ?? {
        path,
        actor,
        ...control,
        widths: [],
        observedInScenarios: [],
        evidenceLevel: "rendered_observation_only",
      };
      if (!record.widths.includes(width)) record.widths.push(width);
      if (!record.observedInScenarios.includes(name)) record.observedInScenarios.push(name);
      renderedControls.set(key, record);
    }
    results.push({ name, width, height, actor, status: "PASS" });
    if ([390, 768, 1280, 1440].includes(width) && name === `${width}px long timeline and composer`)
      await page.screenshot({
        path: `.audit/${evidencePrefix}no-link-browser-${width}.png`,
        fullPage: true,
      });
    console.log(`PASS ${name}`);
  } catch (error) {
    if (await page.getByRole("button", { name: "Show Error" }).count()) {
      await page.getByRole("button", { name: "Show Error" }).click();
      console.error("Route error:", await page.locator("body").innerText());
    }
    await page.screenshot({
      path: `.audit/${evidencePrefix}no-link-browser-${results.length}.png`,
      fullPage: true,
    });
    results.push({ name, width, height, actor, status: "FAIL", error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  } finally {
    await context.close();
  }
}
try {
  browser = await chromium.launch();
  await check("site Inter loads locally and Chinese uses system fonts", 390, async (page) => {
    const requested = [];
    page.on("request", (request) => requested.push(request.url()));
    await open(page, url(ids.a));
    await expect(page.getByLabel("WhatsApp 回覆").filter({ visible: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    // Inter must still be loaded locally for Latin text.
    expect(
      await page.evaluate(() => [...document.fonts].some((face) => face.family.includes("Inter"))),
    ).toBe(true);
    expect(
      await page.evaluate(() => document.fonts.check('16px "Inter"', "Earnest Property")),
    ).toBe(true);
    // The downloaded Noto Chinese web font must be gone: no face, no file request.
    expect(
      await page.evaluate(() => [...document.fonts].some((face) => /noto/i.test(face.family))),
    ).toBe(false);
    expect(requested.filter((u) => /noto-sans-tc|noto.*\.woff2?/i.test(u))).toEqual([]);
    // Chinese text resolves to the system font stack from styles.css.
    const stacks = await page.evaluate(() => {
      const probe = (tag) => {
        const el = document.createElement(tag);
        el.textContent = "碧堤半島";
        document.body.appendChild(el);
        const family = getComputedStyle(el).fontFamily;
        el.remove();
        return family;
      };
      return { display: probe("h2"), body: getComputedStyle(document.body).fontFamily };
    });
    expect(stacks.display.startsWith('"PingFang HK", "PingFang TC", "Microsoft JhengHei"')).toBe(
      true,
    );
    expect(stacks.display).toContain('"Noto Sans CJK HK"');
    expect(
      stacks.body.startsWith('Inter, "PingFang HK", "PingFang TC", "Microsoft JhengHei"'),
    ).toBe(true);
    expect(stacks.body).not.toContain("Variable");
  });
  await check("verified staff names replace ordinary UUIDs", 1280, async (page) => {
    await open(page, url(ids.a));
    const evidence = page.getByRole("region", { name: "查詢及分派證據" });
    await expect(evidence).toContainText("已確認負責人：合成同事甲");
    await expect(evidence).toContainText("指定同事：合成同事甲");
    await expect(evidence).not.toContainText(ids.staff);
    await expect(evidence).toContainText("分派：已確認");
    await expect(evidence).not.toContainText("尚未執行自動分派");
    // FX-17a G-11: 技術資料 is admin-only; the agent's payload carries no staff id at all.
    await expect(page.getByText("技術資料", { exact: true })).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toContain(ids.staff);
    await page.evaluate(() => {
      sessionStorage.setItem("no-link-fixture-actor", "manager");
      sessionStorage.setItem("no-link-fixture-role", "admin");
    });
    await page.reload();
    await expect(evidence).toContainText("已確認負責人：合成同事甲");
    await page.getByRole("button", { name: "技術資料", exact: true }).click();
    await expect(
      page.getByText(ids.staff, { exact: false }).filter({ visible: true }).first(),
    ).toBeVisible();
  });
  for (const width of [360, 390, 768, 1280, 1440]) {
    await check(`${width}px long timeline and composer`, width, async (page) => {
      await open(page, url(ids.a));
      const input = page.getByLabel("WhatsApp 回覆").filter({ visible: true });
      await expect(input).toBeVisible();
      if (width < 1024) {
        const close = page
          .getByRole("button", { name: "關閉", exact: true })
          .filter({ visible: true })
          .first();
        await expect(close).toBeInViewport();
        const closeBox = await close.boundingBox();
        assert.ok(
          closeBox && closeBox.width >= 44 && closeBox.height >= 44,
          `Mobile close target: ${JSON.stringify(closeBox)}`,
        );
      }
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
      await page.evaluate(() => document.fonts.ready);
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
    await open(page, url(ids.a));
    const input = page.getByLabel("WhatsApp 回覆").filter({ visible: true });
    await input.fill("甲盤草稿");
    await page.getByRole("button").filter({ hasText: "合成客戶乙" }).click();
    await expect(input).toHaveValue("");
    await input.fill("乙盤草稿");
    await page.getByRole("button").filter({ hasText: "合成客戶甲" }).click();
    await expect(input).toHaveValue("甲盤草稿");
    await page.reload();
    await page.evaluate(() => document.fonts.ready);
    await expect(input).toHaveValue("甲盤草稿");
  });
  await check("pane resize preserves reading older messages", 390, async (page) => {
    await open(page, url(ids.a));
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
    await open(page, url());
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
    await open(page, url(ids.a));
    const evidence = page.getByRole("region", { name: "查詢及分派證據" });
    await expect(evidence).toContainText("負責同事名稱待核實");
    await expect(evidence).toContainText("指定同事名稱待核實");
    await expect(evidence).not.toContainText(ids.staff);
  });
  await check("unknown assignment is not labelled confirmed", 1280, async (page) => {
    await page.addInitScript(() => sessionStorage.setItem("no-link-fixture-assignment", "unknown"));
    await open(page, url(ids.a));
    await expect(page.getByRole("region", { name: "查詢及分派證據" })).toContainText(
      "分派：結果待核實",
    );
  });
  await check(
    "agent inbox navigation and external ID search retain admin boundary",
    1280,
    async (page) => {
      await open(page, url());
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
      await page.evaluate(() => document.fonts.ready);
      await expect(input).toHaveValue("4033349");
    },
  );
  await check("mobile navigation closes on inbox entry", 390, async (page) => {
    await open(page, url());
    await page.getByRole("button", { name: "開啟後台選單" }).click();
    await page.getByRole("link", { name: "WhatsApp 收件匣", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByLabel("搜尋 WhatsApp 對話")).toBeVisible();
  });
  await check("mobile detail escape retains filter and draft", 390, async (page) => {
    await open(page, `${url(ids.a)}&q=4033349`);
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
      await open(page, url(ids.a));
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
      await open(page, url(ids.a));
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
    await open(page, url(ids.a));
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
      await open(page, url(ids.private));
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
      await open(page, url(ids.a));
      await expect(page.getByText("此帳戶不是職員帳戶", { exact: true })).toBeVisible();
      await expect(page.getByLabel("WhatsApp 回覆")).toHaveCount(0);
    },
    "viewer",
  );
  for (const value of ["true", '{"bad":"shape"}', "9007199254740993"]) {
    await check(`invalid JSON query does not crash: ${value}`, 1280, async (page) => {
      await open(page, `${url(ids.a)}&q=${encodeURIComponent(value)}`);
      await expect(page.getByLabel("搜尋 WhatsApp 對話")).toHaveValue("");
      await expect(page.getByLabel("WhatsApp 回覆").filter({ visible: true })).toBeVisible();
    });
  }
  await check("synthetic composing Enter never invokes send", 390, async (page) => {
    await open(page, url(ids.a));
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
      await open(page, url(ids.a));
      await expect(page.getByRole("heading", { name: "職員登入", exact: true })).toBeVisible();
      await expect(page.getByLabel("WhatsApp 回覆")).toHaveCount(0);
    },
    "guest",
  );
  async function manualForm(page) {
    await page.getByRole("button", { name: "記錄人工轉交", exact: true }).click();
    return page.getByRole("dialog", { name: "記錄人工轉交查詢", exact: true });
  }
  async function fillForward(dialog) {
    await dialog
      .getByLabel("原文／轉交內容")
      .fill("合成原文：客戶想了解碧堤半島，聯絡方式待核實。");
    await dialog.getByLabel("業務來源", { exact: true }).fill("合成同事轉交");
  }
  await check(
    "manual forward unknown result survives refresh and reconciles same request",
    390,
    async (page) => {
      await open(page, `${origin}/admin/leads`);
      let dialog = await manualForm(page);
      await fillForward(dialog);
      await page.evaluate(() => {
        window.noLinkFixture.forwardMode = "timeout";
      });
      await dialog.getByRole("button", { name: "保存人工轉交查詢" }).click();
      await expect(dialog.getByRole("alert")).toBeVisible();
      await page.screenshot({ path: `.audit/${evidencePrefix}no-link-forward-390.png` });
      const first = await page.evaluate(
        () => JSON.parse(sessionStorage.getItem("no-link-fixture-forward-attempts"))[0],
      );
      await page.reload();
      dialog = await manualForm(page);
      await expect(dialog.getByLabel("原文／轉交內容")).toHaveValue(first.text);
      await expect(dialog.getByLabel("原文／轉交內容")).toBeDisabled();
      await dialog.getByRole("button", { name: "核對並重試保存" }).click();
      await expect(page.getByRole("region", { name: "人工轉交來源" })).toContainText(first.text);
      const attempts = await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("no-link-fixture-forward-attempts")),
      );
      expect(attempts).toEqual([first, first]);
      expect(
        await page.evaluate(
          () => JSON.parse(sessionStorage.getItem("no-link-fixture-forward-records")).length,
        ),
      ).toBe(1);
    },
  );
  await check("manual forward pending submit locks fields and Escape close", 390, async (page) => {
    await open(page, `${origin}/admin/leads`);
    const dialog = await manualForm(page);
    await fillForward(dialog);
    await page.evaluate(() => {
      window.noLinkFixture.forwardMode = "delay";
    });
    await dialog.getByRole("button", { name: "保存人工轉交查詢" }).click();
    await expect(dialog.getByRole("button", { name: "正在保存…" })).toBeDisabled();
    await expect(dialog.getByLabel("原文／轉交內容")).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await dialog
      .locator("form")
      .evaluate((form) =>
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
    expect(
      await page.evaluate(
        () => window.noLinkFixture.calls.filter((c) => c.name === "syntheticForward").length,
      ),
    ).toBe(1);
    await page.evaluate(() => window.noLinkFixture.releaseForward());
    await expect(page.getByRole("region", { name: "人工轉交來源" })).toBeVisible();
  });
  await check(
    "manual forward incomplete follow-up validates before sending",
    1280,
    async (page) => {
      await open(page, `${origin}/admin/leads`);
      const dialog = await manualForm(page);
      await fillForward(dialog);
      await dialog.getByLabel("事項", { exact: true }).fill("合成跟進");
      await dialog.getByRole("button", { name: "保存人工轉交查詢" }).click();
      await expect(dialog.getByRole("alert")).toContainText("跟進事項及到期時間須一同填寫");
      expect(
        await page.evaluate(
          () => window.noLinkFixture.calls.filter((c) => c.name === "syntheticForward").length,
        ),
      ).toBe(0);
      await expect(dialog.getByLabel("事項", { exact: true })).toBeEnabled();
    },
  );
  for (const width of [360, 1280]) {
    await check(
      `manual forward ${width}px save and refresh retain provenance without contact or reply`,
      width,
      async (page) => {
        await open(page, `${origin}/admin/leads`);
        const dialog = await manualForm(page);
        await fillForward(dialog);
        await dialog.getByRole("button", { name: "保存人工轉交查詢" }).click();
        const evidence = page.getByRole("region", { name: "人工轉交來源" });
        await expect(evidence).toContainText("合成原文：客戶想了解碧堤半島");
        await expect(evidence).toContainText("尚無原客戶聯絡方式；不能直接回覆原客");
        await expect(evidence).toContainText("轉交同事：合成轉交同事");
        await expect(page.getByRole("link", { name: "查看已授權的 WhatsApp 對話" })).toHaveCount(0);
        await page.reload();
        await expect(evidence).toContainText("合成原文：客戶想了解碧堤半島");
        expect(
          await page.evaluate(
            () => JSON.parse(sessionStorage.getItem("no-link-fixture-forward-records")).length,
          ),
        ).toBe(1);
        expect(
          await page.evaluate(() =>
            sessionStorage.getItem("ep-forwarded-enquiry-draft:v1:agent-a"),
          ),
        ).toBeNull();
      },
    );
  }
  await check(
    "manual forward draft Escape refresh preserves fields and explicit cancel clears",
    390,
    async (page) => {
      await open(page, `${origin}/admin/leads`);
      let dialog = await manualForm(page);
      await fillForward(dialog);
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await page.reload();
      dialog = await manualForm(page);
      await expect(dialog.getByLabel("原文／轉交內容")).toHaveValue(
        "合成原文：客戶想了解碧堤半島，聯絡方式待核實。",
      );
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      dialog = await manualForm(page);
      await expect(dialog.getByLabel("原文／轉交內容")).toHaveValue("");
      expect(
        await page.evaluate(
          () => window.noLinkFixture.calls.filter((c) => c.name === "syntheticForward").length,
        ),
      ).toBe(0);
    },
  );
  await check("manual forward unresolved close reopens frozen same payload", 390, async (page) => {
    await open(page, `${origin}/admin/leads`);
    let dialog = await manualForm(page);
    await fillForward(dialog);
    await page.evaluate(() => {
      window.noLinkFixture.forwardMode = "timeout";
    });
    await dialog.getByRole("button", { name: "保存人工轉交查詢" }).click();
    await expect(dialog.getByRole("alert")).toContainText("尚未核實保存結果");
    await dialog.getByRole("button", { name: "關閉，稍後核對" }).click();
    dialog = await manualForm(page);
    await expect(dialog.getByLabel("原文／轉交內容")).toBeDisabled();
    await dialog.getByRole("button", { name: "核對並重試保存" }).click();
    await expect(page.getByRole("region", { name: "人工轉交來源" })).toBeVisible();
    const attempts = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("no-link-fixture-forward-attempts")),
    );
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(attempts[1]);
  });
  await check(
    "manual forward next assigned actor reads follow-up and cannot see other actor draft",
    390,
    async (page) => {
      await open(page, `${origin}/admin/leads`);
      const dialog = await manualForm(page);
      await fillForward(dialog);
      await dialog.getByLabel("事項", { exact: true }).fill("合成核實原客聯絡方式");
      await dialog.getByLabel("到期時間", { exact: true }).fill("2026-10-01T10:00");
      await dialog
        .getByLabel("負責同事（留空為自己）")
        .selectOption("20000000-0000-4000-8000-000000000002");
      await dialog.getByRole("button", { name: "保存人工轉交查詢" }).click();
      await expect(page.getByRole("region", { name: "人工轉交來源" })).toBeVisible();
      await page.evaluate(() => {
        sessionStorage.setItem("no-link-fixture-actor", "agent-b");
        sessionStorage.setItem(
          "ep-forwarded-enquiry-draft:v1:manager",
          JSON.stringify({
            version: 1,
            fields: {
              requestId: "70000000-0000-4000-8000-000000000001",
              text: "別人的私人草稿",
              businessSource: "合成來源",
              sourceUrl: "",
              originalCustomerContact: "",
              originalReceivedAt: "",
              note: "",
              followUpTitle: "",
              followUpDueAt: "",
              responsibleStaffId: "",
            },
            pending: null,
          }),
        );
      });
      await page.reload();
      await expect(page.getByRole("region", { name: "人工轉交來源" })).toContainText("合成原文");
      await expect(page.getByText("合成核實原客聯絡方式", { exact: true })).toBeVisible();
      await page.goto(`${origin}/admin/leads`);
      const nextDialog = await manualForm(page);
      await expect(nextDialog.getByLabel("原文／轉交內容")).toHaveValue("");
    },
    "manager",
  );
  await check(
    "manual forward unsafe URL validation retains editable form without API call",
    1280,
    async (page) => {
      await open(page, `${origin}/admin/leads`);
      const dialog = await manualForm(page);
      await fillForward(dialog);
      await dialog.getByLabel("來源網址（選填）").fill("http://synthetic.invalid/listing");
      await dialog.getByRole("button", { name: "保存人工轉交查詢" }).click();
      await expect(dialog.getByRole("alert")).toContainText("HTTPS");
      await expect(dialog.getByLabel("來源網址（選填）")).toBeEnabled();
      expect(
        await page.evaluate(
          () => window.noLinkFixture.calls.filter((c) => c.name === "syntheticForward").length,
        ),
      ).toBe(0);
    },
  );
  await check("manual forward unavailable storage refuses submit before API", 390, async (page) => {
    await open(page, `${origin}/admin/leads`);
    const dialog = await manualForm(page);
    await fillForward(dialog);
    await page.evaluate(() => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("ep-forwarded-enquiry-draft:")) throw Error("Synthetic storage failure");
        return write.call(this, key, value);
      };
    });
    await dialog.getByRole("button", { name: "保存人工轉交查詢" }).click();
    await expect(dialog.getByRole("alert")).toContainText("未有送出查詢");
    expect(
      await page.evaluate(
        () => window.noLinkFixture.calls.filter((c) => c.name === "syntheticForward").length,
      ),
    ).toBe(0);
  });
  await check(
    "manual forward late save after route leave does not reopen old lead",
    1280,
    async (page) => {
      await open(page, `${origin}/admin/whatsapp`);
      await page.locator('a[href="/admin/leads"]').filter({ visible: true }).first().click();
      const dialog = await manualForm(page);
      await fillForward(dialog);
      await page.evaluate(() => {
        window.noLinkFixture.forwardMode = "delay";
      });
      await dialog.getByRole("button", { name: "保存人工轉交查詢" }).click();
      await expect(dialog.getByRole("button", { name: "正在保存…" })).toBeDisabled();
      await page.goBack();
      await expect(page.getByLabel("搜尋 WhatsApp 對話")).toBeVisible();
      await page.evaluate(() => window.noLinkFixture.releaseForward());
      await expect.poll(() => page.url()).toBe(`${origin}/admin/whatsapp`);
      // Observe beyond React/router microtasks so an obsolete callback cannot navigate later.
      await page.waitForTimeout(150);
      expect(page.url()).toBe(`${origin}/admin/whatsapp`);
      await expect(page.getByRole("region", { name: "人工轉交來源" })).toHaveCount(0);
    },
  );
  await check(
    "manual forward corrupt unresolved journal blocks a fresh request",
    390,
    async (page) => {
      await open(page, `${origin}/admin/leads`);
      let dialog = await manualForm(page);
      await fillForward(dialog);
      await page.evaluate(() => {
        window.noLinkFixture.forwardMode = "timeout";
      });
      await dialog.getByRole("button", { name: "保存人工轉交查詢" }).click();
      await expect(dialog.getByRole("alert")).toBeVisible();
      await page.evaluate(() =>
        sessionStorage.setItem("ep-forwarded-enquiry-draft:v1:agent-a", "{corrupt"),
      );
      await page.reload();
      dialog = await manualForm(page);
      await expect(dialog.getByRole("alert")).toContainText("草稿受損");
      await expect(dialog.getByLabel("原文／轉交內容")).toBeDisabled();
      await expect(dialog.getByRole("button", { name: "請先核對草稿" })).toBeDisabled();
      expect(
        await page.evaluate(
          () => JSON.parse(sessionStorage.getItem("no-link-fixture-forward-attempts")).length,
        ),
      ).toBe(1);
      expect(
        await page.evaluate(() => sessionStorage.getItem("ep-forwarded-enquiry-draft:v1:agent-a")),
      ).toBe("{corrupt");
    },
  );
  const contactLead = "70000000-0000-4000-8000-000000000001";
  const contactId = "80000000-0000-4000-8000-000000000001";
  async function seedContact(page) {
    await page.context().addInitScript(
      ({ contactLead, contactId, conversationId, staff }) => {
        if (!sessionStorage.getItem("no-link-fixture-forward-records"))
          sessionStorage.setItem(
            "no-link-fixture-forward-records",
            JSON.stringify([
              {
                id: contactLead,
                actor: "agent-a",
                conversationId,
                input: {
                  requestId: "90000000-0000-4000-8000-000000000001",
                  text: "既有合成 WhatsApp 查詢",
                  businessSource: "whatsapp",
                  responsibleStaffId: staff,
                  note: null,
                },
                contact: {
                  id: contactId,
                  name: "既有合成客戶",
                  email: "before@example.test",
                  phone: "+85200000000",
                  optIn: false,
                },
              },
            ]),
          );
      },
      { contactLead, contactId, conversationId: ids.a, staff: ids.staff },
    );
  }
  const contactForm = (page) => page.getByRole("form", { name: "編輯聯絡資料" });
  for (const width of [360, 1280]) {
    await check(
      `contact ${width}px save and refresh preserves lead drafts and identity`,
      width,
      async (page) => {
        await seedContact(page);
        await open(page, `${origin}/admin/leads?lead=${contactLead}`);
        await page.getByRole("button", { name: "編輯姓名／電郵" }).click();
        const form = contactForm(page);
        await form.getByLabel("姓名", { exact: true }).fill("更新合成客戶");
        await form.getByLabel("電郵", { exact: true }).fill("after@example.test");
        await page.getByLabel("最低預算", { exact: true }).fill("1234567");
        await page.getByLabel("內部備註（不會傳送給客戶）", { exact: true }).fill("保留未保存草稿");
        await form.getByRole("button", { name: "儲存聯絡資料" }).click();
        await expect(form).toHaveCount(0);
        await expect(
          page.getByText("更新合成客戶", { exact: true }).filter({ visible: true }).first(),
        ).toBeVisible();
        await expect(page.getByLabel("最低預算", { exact: true })).toHaveValue("1234567");
        await expect(page.getByLabel("內部備註（不會傳送給客戶）", { exact: true })).toHaveValue(
          "保留未保存草稿",
        );
        const input = await page.evaluate(
          () => window.noLinkFixture.calls.find((c) => c.name === "syntheticContact").input,
        );
        expect(input).toEqual({
          leadId: contactLead,
          name: "更新合成客戶",
          email: "after@example.test",
          expectedContactId: contactId,
          expectedName: "既有合成客戶",
          expectedEmail: "before@example.test",
        });
        await page.reload();
        await expect(
          page.getByText("更新合成客戶", { exact: true }).filter({ visible: true }).first(),
        ).toBeVisible();
        await expect(
          page.getByText("after@example.test", { exact: true }).filter({ visible: true }).first(),
        ).toBeVisible();
        await expect(page.locator("dd").getByText("+85200000000", { exact: true })).toBeVisible();
        await expect(page.locator("dd").getByText("未有推廣同意", { exact: true })).toBeVisible();
      },
    );
  }
  await check("contact cancel and invalid email perform no write", 390, async (page) => {
    await seedContact(page);
    await open(page, `${origin}/admin/leads?lead=${contactLead}`);
    await page.getByRole("button", { name: "編輯姓名／電郵" }).click();
    await contactForm(page).getByLabel("姓名", { exact: true }).fill("取消草稿");
    await contactForm(page).getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "編輯姓名／電郵" }).click();
    await expect(contactForm(page).getByLabel("姓名", { exact: true })).toHaveValue("既有合成客戶");
    await contactForm(page).getByLabel("電郵", { exact: true }).fill("invalid");
    await contactForm(page).getByRole("button", { name: "儲存聯絡資料" }).click();
    expect(
      await page.evaluate(
        () => window.noLinkFixture.calls.filter((c) => c.name === "syntheticContact").length,
      ),
    ).toBe(0);
    await expect(contactForm(page).getByLabel("電郵", { exact: true })).toHaveValue("invalid");
  });
  await check("contact pending save disables edits and duplicate submit", 390, async (page) => {
    await seedContact(page);
    await open(page, `${origin}/admin/leads?lead=${contactLead}`);
    await page.getByRole("button", { name: "編輯姓名／電郵" }).click();
    await contactForm(page).getByLabel("姓名", { exact: true }).fill("等待中的修改");
    await page.evaluate(() => {
      window.noLinkFixture.contactMode = "delay";
    });
    await contactForm(page).getByRole("button", { name: "儲存聯絡資料" }).click();
    await expect(contactForm(page).getByLabel("姓名", { exact: true })).toBeDisabled();
    await expect(contactForm(page).getByLabel("電郵", { exact: true })).toBeDisabled();
    await expect(
      contactForm(page).getByRole("button", { name: "取消", exact: true }),
    ).toBeDisabled();
    await contactForm(page).evaluate((form) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    expect(
      await page.evaluate(
        () => window.noLinkFixture.calls.filter((c) => c.name === "syntheticContact").length,
      ),
    ).toBe(1);
    await page.evaluate(() => window.noLinkFixture.releaseContact());
    await expect(contactForm(page)).toHaveCount(0);
    await expect(
      page.getByText("等待中的修改", { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
  });
  await check("contact stale snapshot requires readback before a new edit", 1280, async (page) => {
    await seedContact(page);
    await open(page, `${origin}/admin/leads?lead=${contactLead}`);
    await page.getByRole("button", { name: "編輯姓名／電郵" }).click();
    await contactForm(page).getByLabel("姓名", { exact: true }).fill("過期草稿");
    await page.evaluate(() => {
      const records = JSON.parse(sessionStorage.getItem("no-link-fixture-forward-records"));
      records[0].contact.name = "另一同事新修改";
      sessionStorage.setItem("no-link-fixture-forward-records", JSON.stringify(records));
    });
    await contactForm(page).getByRole("button", { name: "儲存聯絡資料" }).click();
    await expect(contactForm(page).getByRole("alert")).toContainText("請先重新載入");
    await expect(contactForm(page).getByLabel("姓名", { exact: true })).toBeDisabled();
    await expect(contactForm(page).getByRole("button", { name: "儲存聯絡資料" })).toBeDisabled();
    await contactForm(page).getByRole("button", { name: "重新載入聯絡資料" }).click();
    await expect(contactForm(page)).toHaveCount(0);
    await page.getByRole("button", { name: "編輯姓名／電郵" }).click();
    await expect(contactForm(page).getByLabel("姓名", { exact: true })).toHaveValue(
      "另一同事新修改",
    );
    expect(
      await page.evaluate(
        () => window.noLinkFixture.calls.filter((c) => c.name === "syntheticContact").length,
      ),
    ).toBe(1);
  });
  await check("contact lost response and failed readback never resends", 390, async (page) => {
    await seedContact(page);
    await open(page, `${origin}/admin/leads?lead=${contactLead}`);
    await page.getByRole("button", { name: "編輯姓名／電郵" }).click();
    await contactForm(page).getByLabel("姓名", { exact: true }).fill("結果待核對");
    await page.evaluate(() => {
      window.noLinkFixture.contactMode = "timeout";
      window.noLinkFixture.contactReadFailure = true;
    });
    await contactForm(page).getByRole("button", { name: "儲存聯絡資料" }).click();
    await expect(contactForm(page).getByRole("alert")).toContainText("儲存結果未能確認");
    await expect(
      contactForm(page).getByRole("button", { name: "重新載入聯絡資料" }),
    ).toBeInViewport();
    expect(
      await contactForm(page).evaluate((form) => form.scrollWidth <= form.clientWidth + 1),
    ).toBe(true);
    await contactForm(page).getByRole("button", { name: "重新載入聯絡資料" }).click();
    await expect(contactForm(page).getByRole("alert")).toContainText("未有重送修改");
    await expect(contactForm(page).getByLabel("姓名", { exact: true })).toBeDisabled();
    await page.evaluate(() => {
      window.noLinkFixture.contactReadFailure = false;
    });
    await contactForm(page).getByRole("button", { name: "重新載入聯絡資料" }).click();
    await expect(contactForm(page)).toHaveCount(0);
    await expect(
      page.getByText("結果待核對", { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => window.noLinkFixture.calls.filter((c) => c.name === "syntheticContact").length,
      ),
    ).toBe(1);
    await page.reload();
    await expect(
      page.getByText("結果待核對", { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
  });
  await check(
    "contact next model actor reads change and unassigned actor sees no edit",
    1280,
    async (page) => {
      await seedContact(page);
      await open(page, `${origin}/admin/leads?lead=${contactLead}`);
      await page.getByRole("button", { name: "編輯姓名／電郵" }).click();
      await contactForm(page).getByLabel("姓名", { exact: true }).fill("下一同事可核對");
      await contactForm(page).getByRole("button", { name: "儲存聯絡資料" }).click();
      await expect(contactForm(page)).toHaveCount(0);
      await page.evaluate(() => sessionStorage.setItem("no-link-fixture-actor", "manager"));
      await page.reload();
      await expect(
        page.getByText("下一同事可核對", { exact: true }).filter({ visible: true }).first(),
      ).toBeVisible();
      await page.evaluate(() => sessionStorage.setItem("no-link-fixture-actor", "agent-b"));
      await page.reload();
      await expect(page.getByRole("button", { name: "編輯姓名／電郵" })).toHaveCount(0);
      await expect(page.getByText("下一同事可核對", { exact: true })).toHaveCount(0);
    },
  );
  await check(
    "contact late completion after leaving route cannot reopen CRM",
    1280,
    async (page) => {
      await seedContact(page);
      await open(page, `${origin}/admin/whatsapp`);
      await page.locator('a[href="/admin/leads"]').filter({ visible: true }).first().click();
      await page
        .getByText("既有合成客戶", { exact: true })
        .filter({ visible: true })
        .first()
        .click();
      await page.getByRole("button", { name: "編輯姓名／電郵" }).click();
      await contactForm(page).getByLabel("姓名", { exact: true }).fill("遲回修改");
      await page.evaluate(() => {
        window.noLinkFixture.contactMode = "delay";
      });
      await contactForm(page).getByRole("button", { name: "儲存聯絡資料" }).click();
      await expect(contactForm(page).getByLabel("姓名", { exact: true })).toBeDisabled();
      await page.goBack();
      await expect(page.getByLabel("搜尋 WhatsApp 對話")).toBeVisible();
      await page.evaluate(() => window.noLinkFixture.releaseContact());
      await page.waitForTimeout(150);
      expect(page.url()).toBe(`${origin}/admin/whatsapp`);
      await expect(contactForm(page)).toHaveCount(0);
    },
  );
  await check("related authorized source opens existing WhatsApp route", 390, async (page) => {
    await seedContact(page);
    await open(page, `${origin}/admin/leads?lead=${contactLead}`);
    await page.getByRole("link", { name: "查看已授權的 WhatsApp 對話" }).click();
    await expect(page.getByLabel("WhatsApp 回覆").filter({ visible: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("conversation")).toBe(ids.a);
  });
  await check("related source read failure retries without granting access", 390, async (page) => {
    await seedContact(page);
    await page
      .context()
      .addInitScript(() => sessionStorage.setItem("no-link-fixture-related-error", "true"));
    await open(page, `${origin}/admin/leads?lead=${contactLead}`);
    const warning = page.getByRole("alert").filter({ hasText: "未能核對相關對話權限" });
    await expect(warning).toBeVisible();
    await expect(page.getByRole("link", { name: "查看已授權的 WhatsApp 對話" })).toHaveCount(0);
    await page.evaluate(() => {
      window.noLinkFixture.relatedReadFailure = false;
    });
    await warning.getByRole("button", { name: "重新載入", exact: true }).click();
    await expect(page.getByRole("link", { name: "查看已授權的 WhatsApp 對話" })).toBeVisible();
  });
  async function resolutionDialog(page, target = ids.a) {
    await page
      .context()
      .addInitScript(() => sessionStorage.setItem("no-link-fixture-enquiry-review", "true"));
    await open(page, url(target));
    await page
      .getByRole("button", { name: "查看及修正本次查詢" })
      .filter({ visible: true })
      .click();
    return page.getByRole("dialog", { name: "本次查詢例外修正" });
  }
  async function fillResolution(dialog) {
    await dialog
      .getByRole("combobox", { name: /^本次查詢負責同事/ })
      .selectOption("20000000-0000-4000-8000-000000000002");
    await dialog.getByRole("textbox", { name: /^修正原因/ }).fill("已核對本次合成查詢");
  }
  await check(
    "resolution pending save freezes fields and Escape close",
    390,
    async (page) => {
      const dialog = await resolutionDialog(page);
      await fillResolution(dialog);
      await page.evaluate(() => {
        window.noLinkFixture.resolutionMode = "delay";
      });
      await dialog.getByRole("button", { name: "儲存本次查詢修正" }).evaluate((button) => {
        button.click();
        button.click();
      });
      await expect(dialog.getByRole("textbox", { name: /^修正原因/ })).toBeDisabled();
      for (const label of ["MLS 樓盤", "指定同事（已核實外部映射）", "本次查詢負責同事"])
        await expect(
          dialog.getByRole("combobox", {
            name: new RegExp("^" + label.replace(/[（）]/g, "\\$&")),
          }),
        ).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "取消／關閉" })).toBeDisabled();
      expect(
        await page.evaluate(
          () => window.noLinkFixture.calls.filter((c) => c.name === "syntheticCorrection").length,
        ),
      ).toBe(1);
      await page.evaluate(() => window.noLinkFixture.releaseResolution());
      await expect(dialog.getByRole("status").filter({ hasText: "已儲存本次查詢" })).toBeVisible();
    },
    "manager",
  );
  await check(
    "resolution lost response requires readback and never repeats revision",
    390,
    async (page) => {
      const dialog = await resolutionDialog(page);
      await fillResolution(dialog);
      await page.evaluate(() => {
        window.noLinkFixture.resolutionMode = "timeout";
      });
      await dialog.getByRole("button", { name: "儲存本次查詢修正" }).click();
      await expect(dialog.getByRole("button", { name: "重新載入版本（保留草稿）" })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "儲存本次查詢修正" })).toBeDisabled();
      expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await dialog.getByRole("button", { name: "重新載入版本（保留草稿）" }).click();
      await expect(dialog).toContainText("版本 1");
      await expect(dialog.getByRole("textbox", { name: /^修正原因/ })).toHaveValue(
        "已核對本次合成查詢",
      );
      await expect(dialog).toContainText("目前資料已符合草稿");
      await expect(dialog.getByRole("button", { name: "儲存本次查詢修正" })).toBeDisabled();
      expect(
        await page.evaluate(
          () => window.noLinkFixture.calls.filter((c) => c.name === "syntheticCorrection").length,
        ),
      ).toBe(1);
    },
    "manager",
  );
  await check(
    "resolution scoped original text is available for review",
    1280,
    async (page) => {
      const dialog = await resolutionDialog(page);
      await expect(dialog).toContainText("本次合成原文甲：碧堤半島 28Hse ID:4033349");
      await expect(dialog).not.toContainText("本次合成原文乙");
    },
    "manager",
  );
  await check(
    "resolution 360px clear readback survives evidence outage refresh and next actor",
    360,
    async (page) => {
      const dialog = await resolutionDialog(page);
      await dialog.getByRole("combobox", { name: /^指定同事/ }).selectOption("none");
      await dialog.getByRole("textbox", { name: /^修正原因/ }).fill("原指定文字待重新核實");
      await page.evaluate(() => {
        window.noLinkFixture.assignmentFailure = true;
      });
      await dialog.getByRole("button", { name: "儲存本次查詢修正" }).click();
      await expect(dialog.getByRole("status").filter({ hasText: "已儲存本次查詢" })).toBeVisible();
      await expect(
        dialog.getByRole("definition").filter({ hasText: "待核實／未指定" }),
      ).toBeVisible();
      const calls = await page.evaluate(() =>
        window.noLinkFixture.calls.filter((c) => c.name === "syntheticCorrection"),
      );
      expect(calls[0].input).toEqual({
        inquiryId: "30000000-0000-4000-8000-000000000001",
        expectedVersion: 0,
        requestedStaffId: null,
        reason: "原指定文字待重新核實",
      });
      await page.reload();
      await page
        .getByRole("button", { name: "查看及修正本次查詢" })
        .filter({ visible: true })
        .click();
      await expect(dialog).toContainText("版本 1");
      await page.evaluate(() => sessionStorage.setItem("no-link-fixture-actor", "agent-a"));
      await page.reload();
      await page
        .getByRole("button", { name: "查看及修正本次查詢" })
        .filter({ visible: true })
        .click();
      await expect(dialog).toContainText("版本 1");
      await expect(dialog).toContainText("沒有修正權限");
      await expect(dialog.getByRole("button", { name: "儲存本次查詢修正" })).toHaveCount(0);
    },
    "manager",
  );
  await check(
    "resolution cancel unchanged and invalid reason make no API call",
    390,
    async (page) => {
      const dialog = await resolutionDialog(page);
      await dialog.getByRole("button", { name: "儲存本次查詢修正" }).click();
      await expect(dialog.getByRole("alert")).toContainText("請選擇");
      await dialog.getByRole("combobox", { name: /^本次查詢負責同事/ }).selectOption("none");
      await dialog.getByRole("textbox", { name: /^修正原因/ }).fill("x");
      await dialog.getByRole("button", { name: "儲存本次查詢修正" }).click();
      await expect(dialog.getByRole("alert")).toContainText("最少三個字");
      await dialog.getByRole("button", { name: "取消／關閉" }).click();
      await expect(dialog).toHaveCount(0);
      expect(
        await page.evaluate(
          () => window.noLinkFixture.calls.filter((c) => c.name === "syntheticCorrection").length,
        ),
      ).toBe(0);
    },
    "manager",
  );
  await check(
    "resolution agent reads only scoped evidence without mutation controls",
    390,
    async (page) => {
      const dialog = await resolutionDialog(page);
      await expect(dialog).toContainText("本次合成原文甲");
      await expect(dialog).not.toContainText("本次合成原文乙");
      await expect(dialog).toContainText("沒有修正權限");
      await expect(dialog.getByRole("combobox")).toHaveCount(0);
    },
  );
  await check(
    "resolution initial read failure and permission rejection require fresh scope read",
    390,
    async (page) => {
      await page
        .context()
        .addInitScript(() => sessionStorage.setItem("no-link-fixture-resolution-error", "true"));
      const dialog = await resolutionDialog(page);
      await expect(dialog.getByRole("alert")).toContainText("未能讀取");
      await expect(dialog.getByRole("button", { name: "儲存本次查詢修正" })).toHaveCount(0);
      await page.evaluate(() => {
        window.noLinkFixture.resolutionReadFailure = false;
      });
      await dialog.getByRole("button", { name: "重新載入版本（保留草稿）" }).click();
      await fillResolution(dialog);
      await page.evaluate(() => {
        window.noLinkFixture.resolutionMode = "forbidden";
      });
      await dialog.getByRole("button", { name: "儲存本次查詢修正" }).click();
      await expect(dialog.getByRole("alert")).toContainText("權限已變更");
      await expect(dialog.getByRole("button", { name: "儲存本次查詢修正" })).toHaveCount(0);
      expect(
        await page.evaluate(() => sessionStorage.getItem("no-link-fixture-resolutions")),
      ).toBeNull();
    },
    "manager",
  );
  await check(
    "resolution stale reload failure cannot reuse old version or erase draft",
    1280,
    async (page) => {
      const dialog = await resolutionDialog(page);
      await fillResolution(dialog);
      await page.evaluate(() => {
        sessionStorage.setItem(
          "no-link-fixture-resolutions",
          JSON.stringify({
            "30000000-0000-4000-8000-000000000001": {
              version: 1,
              propertyId: "40000000-0000-4000-8000-000000000001",
              requestedStaffId: "20000000-0000-4000-8000-000000000001",
              ownerStaffId: "20000000-0000-4000-8000-000000000001",
              revisions: [],
            },
          }),
        );
      });
      await dialog.getByRole("button", { name: "儲存本次查詢修正" }).click();
      await expect(dialog.getByRole("alert")).toContainText("重新載入");
      await expect(dialog.getByRole("textbox", { name: /^修正原因/ })).toBeDisabled();
      await page.evaluate(() => {
        window.noLinkFixture.resolutionReadFailure = true;
      });
      await dialog.getByRole("button", { name: "重新載入版本（保留草稿）" }).click();
      await expect(dialog.getByRole("alert")).toContainText("未有重送");
      await expect(dialog.getByRole("button", { name: "儲存本次查詢修正" })).toHaveCount(0);
      await page.evaluate(() => {
        window.noLinkFixture.resolutionReadFailure = false;
      });
      await dialog.getByRole("button", { name: "重新載入版本（保留草稿）" }).click();
      await expect(dialog).toContainText("版本 1");
      await expect(dialog.getByRole("textbox", { name: /^修正原因/ })).toHaveValue(
        "已核對本次合成查詢",
      );
      await expect(dialog.getByRole("combobox", { name: /^本次查詢負責同事/ })).toHaveValue(
        "20000000-0000-4000-8000-000000000002",
      );
      await dialog.getByRole("button", { name: "儲存本次查詢修正" }).click();
      await expect(dialog).toContainText("版本 2");
      const inputs = await page.evaluate(() =>
        window.noLinkFixture.calls
          .filter((c) => c.name === "syntheticCorrection")
          .map((c) => c.input),
      );
      expect(inputs.map((i) => i.expectedVersion)).toEqual([0, 1]);
    },
    "manager",
  );
  await check(
    "resolution retired candidate remains explicit and blocks save until reselected",
    390,
    async (page) => {
      const dialog = await resolutionDialog(page);
      await fillResolution(dialog);
      await page.evaluate(() => {
        window.noLinkFixture.retiredCandidate = true;
      });
      await dialog.getByRole("button", { name: "儲存本次查詢修正" }).click();
      await dialog.getByRole("button", { name: "重新載入版本（保留草稿）" }).click();
      await expect(dialog.getByRole("alert")).toContainText("先前選擇已不可用");
      await expect(dialog.getByRole("combobox", { name: /^本次查詢負責同事/ })).toHaveValue(
        "20000000-0000-4000-8000-000000000002",
      );
      await expect(dialog.getByRole("button", { name: "儲存本次查詢修正" })).toBeDisabled();
      await dialog.getByRole("combobox", { name: /^本次查詢負責同事/ }).selectOption("none");
      await dialog.getByRole("button", { name: "儲存本次查詢修正" }).click();
      await expect(dialog).toContainText("版本 1");
    },
    "manager",
  );
  await check(
    "resolution completion after route leave cannot read back into another page",
    1280,
    async (page) => {
      await page
        .context()
        .addInitScript(() => sessionStorage.setItem("no-link-fixture-enquiry-review", "true"));
      await open(page, `${origin}/admin/leads`);
      await page.locator('a[href="/admin/whatsapp"]').filter({ visible: true }).first().click();
      await page
        .getByRole("button", { name: /合成客戶甲/ })
        .filter({ visible: true })
        .click();
      await page
        .getByRole("button", { name: "查看及修正本次查詢" })
        .filter({ visible: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "本次查詢例外修正" });
      await fillResolution(dialog);
      await page.evaluate(() => {
        window.noLinkFixture.resolutionMode = "delay";
      });
      await dialog.getByRole("button", { name: "儲存本次查詢修正" }).click();
      await expect(dialog.getByRole("textbox", { name: /^修正原因/ })).toBeDisabled();
      await page.goBack();
      if (new URL(page.url()).pathname === "/admin/whatsapp") await page.goBack();
      await expect(page.getByRole("button", { name: /^記錄人工轉交/ })).toBeVisible();
      await page.evaluate(() => window.noLinkFixture.releaseResolution());
      await page.waitForTimeout(150);
      expect(new URL(page.url()).pathname).toBe("/admin/leads");
      expect(
        await page.evaluate(
          () => window.noLinkFixture.calls.filter((c) => c.name === "resolutionRead").length,
        ),
      ).toBe(1);
    },
    "manager",
  );
  await check(
    "resolution uncertain close and next enquiry keep identities and drafts separate",
    390,
    async (page) => {
      let dialog = await resolutionDialog(page);
      await fillResolution(dialog);
      await page.evaluate(() => {
        window.noLinkFixture.resolutionMode = "timeout";
      });
      await dialog.getByRole("button", { name: "儲存本次查詢修正" }).click();
      await expect(dialog.getByRole("alert")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      dialog = await resolutionDialog(page, ids.b);
      await expect(dialog).toContainText("本次合成原文乙");
      await expect(dialog).not.toContainText("本次合成原文甲");
      await expect(dialog.getByRole("textbox", { name: /^修正原因/ })).toHaveValue("");
      await expect(dialog.getByRole("combobox", { name: /^本次查詢負責同事/ })).toHaveValue(
        "unchanged",
      );
      await expect(dialog).toContainText("版本 0");
      const records = await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("no-link-fixture-resolutions")),
      );
      expect(records["30000000-0000-4000-8000-000000000001"].revisions).toHaveLength(1);
      expect(records["30000000-0000-4000-8000-000000000002"]).toBeUndefined();
    },
    "manager",
  );
  async function campaignConfirmation(page) {
    await open(page, `${origin}/admin/blasts`);
    const row = page.getByRole("row").filter({ hasText: "合成租務推廣" });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "預覽收件人", exact: true }).click();
    await row.getByRole("button", { name: "發送…", exact: true }).click();
    const dialog = page.getByRole("alertdialog", { name: "確認發送 WhatsApp 群發？" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("checkbox").check();
    return dialog;
  }
  await check(
    "campaign queue success is not represented as delivery",
    1280,
    async (page) => {
      const dialog = await campaignConfirmation(page);
      await dialog.getByRole("button", { name: "確認發送給 2 人", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(page.getByText("已加入發送佇列", { exact: false })).toBeVisible();
      await expect(page.getByText("已發送給 2 位合資格收件人", { exact: true })).toHaveCount(0);
      expect(
        await page.evaluate(
          () => JSON.parse(sessionStorage.getItem("no-link-fixture-campaigns"))[0].queueWrites,
        ),
      ).toBe(1);
    },
    "manager",
  );
  await check(
    "campaign pending queue freezes review and same-tick duplicate",
    390,
    async (page) => {
      const dialog = await campaignConfirmation(page);
      await page.evaluate(() => {
        window.noLinkBlastFixture.queueMode = "delay";
      });
      await dialog
        .getByRole("button", { name: "確認發送給 2 人", exact: true })
        .evaluate((button) => {
          button.click();
          button.click();
        });
      await expect(dialog.getByRole("checkbox")).toBeDisabled();
      await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
      expect(
        await page.evaluate(
          () =>
            window.noLinkFixture.calls.filter((c) => c.name === "syntheticCampaignQueue").length,
        ),
      ).toBe(1);
      await page.evaluate(() => window.noLinkBlastFixture.releaseQueue());
      await expect(dialog).not.toBeVisible();
    },
    "manager",
  );
  await check(
    "campaign lost queue response requires readback and forbids resend",
    360,
    async (page) => {
      const dialog = await campaignConfirmation(page);
      await page.evaluate(() => {
        window.noLinkBlastFixture.queueMode = "timeout";
      });
      await dialog.getByRole("button", { name: "確認發送給 2 人", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("結果未能確認");
      await expect(
        dialog.getByRole("button", { name: "確認發送給 2 人", exact: true }),
      ).toBeDisabled();
      await page.evaluate(() => {
        window.noLinkBlastFixture.readFailure = true;
      });
      await dialog.getByRole("button", { name: "重新載入 Campaign 狀態", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("未能讀回");
      await expect(
        dialog.getByRole("button", { name: "確認發送給 2 人", exact: true }),
      ).toBeDisabled();
      await page.evaluate(() => {
        window.noLinkBlastFixture.readFailure = false;
      });
      await dialog.getByRole("button", { name: "重新載入 Campaign 狀態", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      const row = page.getByRole("row").filter({ hasText: "合成租務推廣" });
      await expect(row).toContainText("已排隊");
      await expect(row.getByRole("button", { name: "發送…", exact: true })).toBeDisabled();
      expect(
        await page.evaluate(
          () =>
            window.noLinkFixture.calls.filter((c) => c.name === "syntheticCampaignQueue").length,
        ),
      ).toBe(1);
      await page.reload();
      await expect(page.getByRole("row").filter({ hasText: "合成租務推廣" })).toContainText(
        "已排隊",
      );
    },
    "manager",
  );
  await check(
    "campaign pristine close cancel and same-name audiences remain explicit",
    1280,
    async (page) => {
      await open(page, `${origin}/admin/blasts`);
      await page.getByRole("button", { name: "新增 Campaign", exact: true }).click();
      const edit = page.getByRole("dialog", { name: "新增 Campaign", exact: true });
      // FX-17a D-13: the schedule field is gone; campaigns go out only through 發送….
      await expect(edit.getByText("計劃發送時間", { exact: false })).toHaveCount(0);
      await edit.getByLabel("Campaign audience", { exact: true }).click();
      await expect(page.getByRole("option").filter({ hasText: "深井租客" })).toBeVisible();
      await expect(page.getByRole("option").filter({ hasText: "荃灣買家" })).toBeVisible();
      await page.keyboard.press("Escape");
      await edit.getByRole("button", { name: "關閉", exact: true }).click();
      await expect(edit).not.toBeVisible();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      const dialog = await campaignConfirmation(page);
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      expect(
        await page.evaluate(
          () =>
            window.noLinkFixture.calls.filter((c) =>
              ["syntheticCampaignQueue", "syntheticCampaignSave"].includes(c.name),
            ).length,
        ),
      ).toBe(0);
    },
    "manager",
  );
  await check(
    "campaign stale preview blocks direct confirmation",
    1280,
    async (page) => {
      const dialog = await campaignConfirmation(page);
      await page.evaluate(() => {
        const current = Date.now();
        Date.now = () => current + 61000;
      });
      await dialog.getByRole("button", { name: "確認發送給 2 人", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("預覽已過期");
      expect(
        await page.evaluate(
          () =>
            window.noLinkFixture.calls.filter((c) => c.name === "syntheticCampaignQueue").length,
        ),
      ).toBe(0);
    },
    "manager",
  );
  await check(
    "campaign preview failure and unapproved template cannot queue",
    1280,
    async (page) => {
      await open(page, `${origin}/admin/blasts`);
      const row = page.getByRole("row").filter({ hasText: "合成租務推廣" });
      await expect(row).toBeVisible();
      await page.evaluate(() => {
        window.noLinkBlastFixture.previewFailure = true;
      });
      await row.getByRole("button", { name: "預覽收件人", exact: true }).click();
      await expect(row.getByRole("button", { name: "發送…", exact: true })).toBeDisabled();
      await page.evaluate(() => {
        window.noLinkBlastFixture.previewFailure = false;
        window.noLinkBlastFixture.templateStatus = "rejected";
      });
      await page.getByRole("button", { name: "重新整理", exact: true }).click();
      await row.getByRole("button", { name: "預覽收件人", exact: true }).click();
      await row.getByRole("button", { name: "發送…", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      expect(
        await page.evaluate(
          () =>
            window.noLinkFixture.calls.filter((c) => c.name === "syntheticCampaignQueue").length,
        ),
      ).toBe(0);
    },
    "manager",
  );
  await check(
    "campaign denied actor cannot obtain campaigns or queue",
    390,
    async (page) => {
      await open(page, `${origin}/admin/blasts`);
      await expect(
        page.getByText("尚未取得已核實的推廣管理權限。", { exact: false }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            window.noLinkFixture.calls.filter((c) =>
              /^synthetic(Campaign|Audience|Blast|Options)/.test(c.name),
            ).length,
        ),
      ).toBe(0);
      await expect(page.getByRole("button", { name: /新增 Campaign/ })).toHaveCount(0);
    },
    "agent-b",
  );
  await check(
    "campaign unknown close retains readback gate",
    390,
    async (page) => {
      const dialog = await campaignConfirmation(page);
      await page.evaluate(() => {
        window.noLinkBlastFixture.queueMode = "timeout";
      });
      await dialog.getByRole("button", { name: "確認發送給 2 人", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("結果未能確認");
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      const recovery = page.getByRole("alert").filter({ hasText: "加入佇列結果未能確認" });
      await expect(recovery).toBeVisible();
      await page.getByRole("button", { name: "重新整理", exact: true }).click();
      await expect(recovery).toBeVisible();
      await recovery.getByRole("button", { name: "重新載入 Campaign 狀態", exact: true }).click();
      await expect(recovery).toHaveCount(0);
      expect(
        await page.evaluate(
          () =>
            window.noLinkFixture.calls.filter((c) => c.name === "syntheticCampaignQueue").length,
        ),
      ).toBe(1);
    },
    "manager",
  );
  await check(
    "campaign rejected queue needs new read preview and confirmation",
    1280,
    async (page) => {
      const dialog = await campaignConfirmation(page);
      await page.evaluate(() => {
        window.noLinkBlastFixture.queueMode = "refused";
      });
      await dialog.getByRole("button", { name: "確認發送給 2 人", exact: true }).click();
      await expect(
        dialog.getByRole("button", { name: "確認發送給 2 人", exact: true }),
      ).toBeDisabled();
      await dialog.getByRole("button", { name: "重新載入 Campaign 狀態", exact: true }).click();
      const row = page.getByRole("row").filter({ hasText: "合成租務推廣" });
      await expect(row.getByRole("button", { name: "發送…", exact: true })).toBeDisabled();
      expect(
        await page.evaluate(
          () =>
            window.noLinkFixture.calls.filter((c) => c.name === "syntheticCampaignQueue").length,
        ),
      ).toBe(1);
      await page.evaluate(() => {
        window.noLinkBlastFixture.queueMode = "ok";
      });
      await row.getByRole("button", { name: "預覽收件人", exact: true }).click();
      await row.getByRole("button", { name: "發送…", exact: true }).click();
      await dialog.getByRole("checkbox").check();
      await dialog.getByRole("button", { name: "確認發送給 2 人", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      expect(
        await page.evaluate(
          () => JSON.parse(sessionStorage.getItem("no-link-fixture-campaigns"))[0].queueWrites,
        ),
      ).toBe(1);
    },
    "manager",
  );
  await check(
    "campaign saved draft cannot queue again after queued readback",
    1280,
    async (page) => {
      await open(page, `${origin}/admin/blasts`);
      await page.getByRole("button", { name: "新增 Campaign", exact: true }).click();
      let edit = page.getByRole("dialog", { name: "新增 Campaign", exact: true });
      await edit.getByLabel("Campaign 名稱", { exact: true }).fill("合成新推廣");
      await edit.getByLabel("Campaign status", { exact: true }).click();
      await page.getByRole("option", { name: "待審核", exact: true }).click();
      await edit.getByRole("button", { name: "儲存", exact: true }).click();
      edit = page.getByRole("dialog", { name: "編輯 Campaign", exact: true });
      await expect(edit.getByRole("button", { name: "發送…", exact: true })).toBeEnabled();
      await edit.getByRole("button", { name: "發送…", exact: true }).click();
      const dialog = page.getByRole("alertdialog", { name: "確認發送 WhatsApp 群發？" });
      await dialog.getByRole("checkbox").check();
      await page.evaluate(() => {
        window.noLinkBlastFixture.queueMode = "timeout";
      });
      await dialog.getByRole("button", { name: "確認發送給 2 人", exact: true }).click();
      await dialog.getByRole("button", { name: "重新載入 Campaign 狀態", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(edit.getByRole("button", { name: "發送…", exact: true })).toBeDisabled();
      await expect(edit).toContainText("目前 Campaign 狀態不能加入發送佇列");
      expect(
        await page.evaluate(
          () =>
            window.noLinkFixture.calls.filter((c) => c.name === "syntheticCampaignQueue").length,
        ),
      ).toBe(1);
    },
    "manager",
  );
  await check(
    "campaign missing templates displays unavailable and makes no write",
    390,
    async (page) => {
      await open(page, `${origin}/admin/blasts`);
      await page.evaluate(() => {
        window.noLinkBlastFixture.noTemplates = true;
      });
      await page.getByRole("button", { name: "重新整理", exact: true }).click();
      await page.getByRole("button", { name: "新增 Campaign", exact: true }).click();
      const edit = page.getByRole("dialog", { name: "新增 Campaign", exact: true });
      await expect(edit).toContainText("未選擇範本");
      await expect(edit.getByRole("button", { name: "發送…", exact: true })).toBeDisabled();
      await edit.getByLabel("Campaign 名稱", { exact: true }).fill("缺範本推廣");
      await edit.getByRole("button", { name: "儲存", exact: true }).click();
      expect(
        await page.evaluate(
          () =>
            window.noLinkFixture.calls.filter((c) =>
              ["syntheticCampaignQueue", "syntheticCampaignSave"].includes(c.name),
            ).length,
        ),
      ).toBe(0);
    },
    "manager",
  );
  await check(
    "campaign desktop recipient statistics are visible with distinct exclusion total",
    1280,
    async (page) => {
      await open(page, `${origin}/admin/blasts`);
      const heading = page
        .getByText("收件人預覽", { exact: true })
        .filter({ visible: true })
        .last();
      const card = heading.locator("xpath=ancestor::div[contains(@class,'h-fit')][1]");
      await expect(card.getByText("總數", { exact: true }).locator("..")).toContainText("4");
      await expect(
        card.getByText("合資格（電話去重）", { exact: true }).locator(".."),
      ).toContainText("2");
      await expect(
        card.getByText("不合資格（按收件人去重）", { exact: true }).locator(".."),
      ).toContainText("2");
      await expect(card).toContainText("排除原因可重疊");
      await card.scrollIntoViewIfNeeded();
      await expect(card).toBeInViewport({ ratio: 0.5 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    },
    "manager",
  );
  const openStaffWork = async (page) => {
    await page.addInitScript(() => sessionStorage.setItem("no-link-fixture-staff-work", "true"));
    await open(page, url());
    const panel = page.getByRole("region", { name: "我的接手工作" });
    await expect(panel.getByRole("button", { name: "確認接手", exact: true })).toBeVisible();
    return panel;
  };
  await check(
    "staff work same-tick duplicate acknowledgement is one request",
    390,
    async (page) => {
      const panel = await openStaffWork(page);
      await page.evaluate(() => {
        window.noLinkStaffWorkFixture.mode = "delay";
      });
      await panel.getByRole("button", { name: "確認接手", exact: true }).evaluate((button) => {
        button.click();
        button.click();
      });
      await expect
        .poll(() =>
          page.evaluate(
            () => window.noLinkStaffWorkFixture.calls.filter((c) => c.name === "ack").length,
          ),
        )
        .toBe(1);
      await expect(panel.getByRole("button", { name: "確認接手", exact: true })).toBeDisabled();
      await page.evaluate(() => window.noLinkStaffWorkFixture.release());
      await expect(panel).toContainText("此頁沒有你的接手工作");
      await panel.getByLabel("接手工作狀態").selectOption("all");
      await expect(panel).toContainText("已確認接手");
      await expect(panel).toContainText("仍待人手回覆");
      await expect(panel).toContainText("不代表同事手機通知");
      await page.reload();
      await page.getByLabel("接手工作狀態").selectOption("all");
      await expect(page.getByRole("region", { name: "我的接手工作" })).toContainText("已確認接手");
    },
  );
  await check("staff work pending help freezes reason and duplicate", 360, async (page) => {
    const panel = await openStaffWork(page);
    const reason = panel.getByLabel("需要協助原因");
    await reason.fill("合成原因：需要原有負責人協調");
    await page.evaluate(() => {
      window.noLinkStaffWorkFixture.mode = "delay";
    });
    await panel.getByRole("button", { name: "需要協助", exact: true }).evaluate((button) => {
      button.click();
      button.click();
    });
    await expect(reason).toBeDisabled();
    await expect
      .poll(() =>
        page.evaluate(
          () => window.noLinkStaffWorkFixture.calls.filter((c) => c.name === "help").length,
        ),
      )
      .toBe(1);
    await page.evaluate(() => window.noLinkStaffWorkFixture.release());
    await expect(panel.getByRole("button", { name: "已記錄協助要求" })).toBeDisabled();
    await expect(panel).toContainText("尚未確認");
    expect(
      await page.evaluate(
        () => window.noLinkStaffWorkFixture.calls.find((c) => c.name === "help").input.reason,
      ),
    ).toBe("合成原因：需要原有負責人協調");
  });
  await check("staff work failed readback keeps stale card locked", 390, async (page) => {
    const panel = await openStaffWork(page);
    await panel.getByLabel("接手工作狀態").selectOption("all");
    await page.evaluate(() => {
      window.noLinkStaffWorkFixture.mode = "timeout";
      window.noLinkStaffWorkFixture.readFailure = true;
    });
    await panel.getByRole("button", { name: "確認接手", exact: true }).click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(panel.getByRole("button", { name: "確認接手", exact: true })).toBeDisabled();
    await panel.getByRole("button", { name: "更新接手工作" }).click();
    await expect(panel.getByRole("button", { name: "確認接手", exact: true })).toBeDisabled();
    await page.evaluate(() => {
      window.noLinkStaffWorkFixture.readFailure = false;
    });
    await panel.getByRole("button", { name: "更新接手工作" }).click();
    await expect(panel).toContainText("已確認接手");
    await expect(panel.getByRole("button", { name: "確認接手", exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(
        () => window.noLinkStaffWorkFixture.calls.filter((c) => c.name === "ack").length,
      ),
    ).toBe(1);
  });
  await check(
    "staff work ordinary view uses names with UUID diagnostics closed",
    768,
    async (page) => {
      const panel = await openStaffWork(page);
      await expect(panel).toContainText("A074714");
      await expect(panel).toContainText("合成指定同事乙");
      await expect(panel).toContainText("合成同事甲");
      expect(await panel.innerText()).not.toContain("30000000-0000-4000-8000-000000000001");
      // FX-17a G-11: an agent gets no 技術資料 and no provider evidence; an admin can open it.
      await expect(panel.getByText("技術資料", { exact: true })).toHaveCount(0);
      expect(await panel.innerText()).not.toContain("private_note_posted");
      await page.evaluate(() => {
        sessionStorage.setItem("no-link-fixture-actor", "manager");
        sessionStorage.setItem("no-link-fixture-role", "admin");
      });
      await page.reload();
      await expect(panel).toContainText("A074714");
      await panel.getByRole("button", { name: "技術資料", exact: true }).click();
      expect(await panel.innerText()).toContain("30000000-0000-4000-8000-000000000001");
      await expect(panel).toContainText("證據類型：private_note_posted");
    },
  );
  await check(
    "staff work lost help response reads existing result without acknowledgement",
    390,
    async (page) => {
      const panel = await openStaffWork(page);
      await panel.getByLabel("需要協助原因").fill("合成手機通知未核實，請原 owner 協調");
      await page.evaluate(() => {
        window.noLinkStaffWorkFixture.mode = "timeout";
      });
      await panel.getByRole("button", { name: "需要協助", exact: true }).click();
      await expect(panel.getByRole("button", { name: "已記錄協助要求" })).toBeDisabled();
      await expect(panel).toContainText("尚未確認");
      await expect(panel).toContainText("仍待人手回覆");
      expect(
        await page.evaluate(
          () => window.noLinkStaffWorkFixture.calls.filter((c) => c.name === "help").length,
        ),
      ).toBe(1);
      expect(
        await page.evaluate(
          () => window.noLinkStaffWorkFixture.calls.filter((c) => c.name === "ack").length,
        ),
      ).toBe(0);
    },
  );
  await check(
    "staff work stale assignment removes old actions after scoped readback",
    768,
    async (page) => {
      const panel = await openStaffWork(page);
      await panel.getByLabel("接手工作狀態").selectOption("all");
      await page.evaluate(() => {
        sessionStorage.setItem(
          "no-link-fixture-staff-work-record",
          JSON.stringify({
            id: "60000000-0000-4000-8000-000000000001",
            inquiryId: "30000000-0000-4000-8000-000000000001",
            conversationId: "10000000-0000-4000-8000-000000000001",
            assignmentVersion: 4,
            purpose: "action_required",
            workState: "superseded",
            canAct: false,
            publicListingNo: "A074714",
            dealType: "sale",
            source: "28Hse",
            requestedName: "合成指定同事乙",
            handlerName: "合成同事乙",
            attempts: [],
          }),
        );
      });
      await panel.getByRole("button", { name: "確認接手", exact: true }).click();
      await expect(panel).toContainText("已轉交");
      await expect(panel.getByRole("button", { name: "確認接手", exact: true })).toHaveCount(0);
      await expect(panel.getByRole("button", { name: "需要協助", exact: true })).toHaveCount(0);
      expect(
        await page.evaluate(
          () => window.noLinkStaffWorkFixture.calls.filter((c) => c.name === "ack").length,
        ),
      ).toBe(1);
    },
  );
  await check("staff work invalid reason and 500 character boundary", 1280, async (page) => {
    const panel = await openStaffWork(page);
    const reason = panel.getByLabel("需要協助原因");
    await reason.fill("   ");
    await expect(panel.getByRole("button", { name: "需要協助", exact: true })).toBeDisabled();
    expect(
      await page.evaluate(
        () => window.noLinkStaffWorkFixture.calls.filter((c) => c.name === "help").length,
      ),
    ).toBe(0);
    await expect(reason).toHaveAttribute("maxlength", "500");
    await reason.fill("合".repeat(500));
    await panel.getByRole("button", { name: "需要協助", exact: true }).click();
    await expect(panel.getByRole("button", { name: "已記錄協助要求" })).toBeDisabled();
    expect(
      await page.evaluate(
        () =>
          window.noLinkStaffWorkFixture.calls.find((c) => c.name === "help").input.reason.length,
      ),
    ).toBe(500);
  });
  await check(
    "staff work open enquiry carries selected query and conversation",
    390,
    async (page) => {
      const panel = await openStaffWork(page);
      await panel.getByRole("button", { name: "查看查詢", exact: true }).click();
      await expect(page.getByLabel("WhatsApp 回覆").filter({ visible: true })).toBeVisible();
      const current = new URL(page.url());
      expect(current.searchParams.get("conversation")).toBe(ids.a);
      expect(current.searchParams.get("enquiry")).toBe("30000000-0000-4000-8000-000000000001");
      expect(current.searchParams.get("notification")).toBe("60000000-0000-4000-8000-000000000001");
      expect(
        await page.evaluate(
          () =>
            window.noLinkStaffWorkFixture.calls.filter((c) => ["help", "ack"].includes(c.name))
              .length,
        ),
      ).toBe(0);
    },
  );
  await check("staff work next actor sees only their own work", 390, async (page) => {
    const panel = await openStaffWork(page);
    await panel.getByRole("button", { name: "確認接手", exact: true }).click();
    await expect(panel).toContainText("此頁沒有你的接手工作");
    await page.evaluate(() => sessionStorage.setItem("no-link-fixture-actor", "agent-b"));
    await page.reload();
    await page.getByLabel("接手工作狀態").selectOption("all");
    await expect(page.getByRole("region", { name: "我的接手工作" })).toContainText(
      "此頁沒有你的接手工作",
    );
    await expect(page.getByRole("button", { name: "確認接手", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "需要協助", exact: true })).toHaveCount(0);
  });
  await check(
    "staff work completion after route leave cannot reload another actor view",
    1280,
    async (page) => {
      const panel = await openStaffWork(page);
      await panel.getByLabel("需要協助原因").fill("合成離開頁面前的協助原因");
      await page.evaluate(() => {
        window.noLinkStaffWorkFixture.mode = "delay";
      });
      await panel.getByRole("button", { name: "需要協助", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => Boolean(window.noLinkStaffWorkFixture.release)))
        .toBe(true);
      await page.locator('a[href="/admin/leads"]').filter({ visible: true }).first().click();
      await expect(page.getByRole("region", { name: "我的接手工作" })).toHaveCount(0);
      const reads = await page.evaluate(
        () => window.noLinkStaffWorkFixture.calls.filter((c) => c.name === "read").length,
      );
      await page.evaluate(() => window.noLinkStaffWorkFixture.release());
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      expect(new URL(page.url()).pathname).toBe("/admin/leads");
      expect(
        await page.evaluate(
          () => window.noLinkStaffWorkFixture.calls.filter((c) => c.name === "read").length,
        ),
      ).toBe(reads);
    },
  );
  await check("outbound same-tick reply duplicate is one queue request", 390, async (page) => {
    await open(page, url(ids.a));
    await page.getByLabel("WhatsApp 回覆").filter({ visible: true }).fill("合成回覆，只傳一次");
    await page.evaluate(() => {
      window.noLinkOutboundFixture.mode = "delay";
    });
    await page.getByRole("button", { name: "傳送回覆", exact: true }).evaluate((button) => {
      button.click();
      button.click();
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => window.noLinkOutboundFixture.calls.filter((c) => c.name === "text").length,
        ),
      )
      .toBe(1);
    await expect(page.getByLabel("WhatsApp 回覆").filter({ visible: true })).toBeDisabled();
    await page.evaluate(() => window.noLinkOutboundFixture.release());
    await expect(page.getByLabel("WhatsApp 回覆").filter({ visible: true })).toHaveValue("");
    await expect(page.getByText("回覆已加入傳送佇列", { exact: true })).toBeVisible();
  });
  await check(
    "outbound unknown reply preserves journal and draft without fake queue success",
    390,
    async (page) => {
      await open(page, url(ids.a));
      const input = page.getByLabel("WhatsApp 回覆").filter({ visible: true });
      await input.fill("合成結果不明的回覆");
      await page.evaluate(() => {
        window.noLinkOutboundFixture.mode = "unknown";
      });
      await page.getByRole("button", { name: "傳送回覆", exact: true }).click();
      await expect(input).toHaveValue("合成結果不明的回覆");
      await expect(page.getByRole("button", { name: "傳送回覆", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "核對傳送狀態", exact: true })).toBeVisible();
      await expect(page.getByText("回覆已加入傳送佇列", { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "核對傳送狀態", exact: true }).click();
      await expect(page.getByRole("button", { name: "傳送回覆", exact: true })).toBeDisabled();
      expect(
        await page.evaluate(
          () => window.noLinkOutboundFixture.calls.filter((c) => c.name === "text").length,
        ),
      ).toBe(1);
      expect(
        await page.evaluate(
          () => Object.keys(sessionStorage).filter((k) => k.includes(":outbound:")).length,
        ),
      ).toBe(1);
    },
  );
  await check(
    "outbound lost reply response requires readonly recovery across reload",
    390,
    async (page) => {
      await open(page, url(ids.a));
      const input = page.getByLabel("WhatsApp 回覆").filter({ visible: true });
      await input.fill("合成已入queue但回應遺失");
      await page.evaluate(() => {
        window.noLinkOutboundFixture.mode = "timeout";
        window.noLinkOutboundFixture.readFailure = true;
      });
      await page.getByRole("button", { name: "傳送回覆", exact: true }).click();
      await expect(page.getByRole("button", { name: "核對傳送狀態", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "核對傳送狀態", exact: true }).click();
      await expect(page.getByRole("button", { name: "傳送回覆", exact: true })).toBeDisabled();
      await expect(input).toHaveValue("合成已入queue但回應遺失");
      expect(
        await page.evaluate(
          () => window.noLinkOutboundFixture.calls.filter((c) => c.name === "text").length,
        ),
      ).toBe(1);
      await page.reload();
      await expect(page.getByRole("button", { name: "核對傳送狀態", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "傳送回覆", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "核對傳送狀態", exact: true }).click();
      await expect(input).toHaveValue("");
      expect(
        await page.evaluate(
          () => window.noLinkOutboundFixture.calls.filter((c) => c.name === "text").length,
        ),
      ).toBe(0);
      expect(
        await page.evaluate(
          () => JSON.parse(sessionStorage.getItem("no-link-fixture-outbound")).length,
        ),
      ).toBe(1);
    },
  );
  await check("outbound unknown template keeps original request reserved", 390, async (page) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("no-link-fixture-window", "expired");
      sessionStorage.setItem("no-link-fixture-reply-template", "true");
    });
    await open(page, url(ids.a));
    await page.getByLabel("選擇範本").filter({ visible: true }).click();
    await page.getByRole("option", { name: "synthetic_reply（zh_HK）" }).click();
    await page.evaluate(() => {
      window.noLinkOutboundFixture.mode = "unknown";
    });
    await page.getByRole("button", { name: "傳送範本", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "傳送", exact: true }).click();
    await expect(page.getByRole("button", { name: "核對傳送狀態", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "傳送範本", exact: true })).toBeDisabled();
    await expect(page.getByText("範本已加入傳送佇列", { exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(
        () => Object.keys(sessionStorage).filter((k) => k.includes(":outbound:")).length,
      ),
    ).toBe(1);
  });
  await check("outbound resolved acceptance is still not delivery", 390, async (page) => {
    await open(page, url(ids.a));
    const input = page.getByLabel("WhatsApp 回覆").filter({ visible: true });
    await input.fill("合成待核對回覆");
    await page.evaluate(() => {
      window.noLinkOutboundFixture.mode = "unknown";
    });
    await page.getByRole("button", { name: "傳送回覆", exact: true }).click();
    await expect(page.getByRole("button", { name: "核對傳送狀態", exact: true })).toBeVisible();
    await page.evaluate(() => {
      const entries = JSON.parse(sessionStorage.getItem("no-link-fixture-outbound"));
      entries[0].state = "accepted";
      sessionStorage.setItem("no-link-fixture-outbound", JSON.stringify(entries));
    });
    await page.getByRole("button", { name: "核對傳送狀態", exact: true }).click();
    await expect(input).toHaveValue("");
    await expect(
      page.getByText("已交 WhatsApp 發送，尚未確認送達或已讀。", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => window.noLinkOutboundFixture.calls.filter((c) => c.name === "text").length,
      ),
    ).toBe(1);
    expect(
      await page.evaluate(
        () => Object.keys(sessionStorage).filter((k) => k.includes(":outbound:")).length,
      ),
    ).toBe(0);
  });
  await check("outbound corrupt journal stays blocked after reload and read", 390, async (page) => {
    await open(page, url(ids.a));
    await page.getByLabel("WhatsApp 回覆").filter({ visible: true }).fill("合成保留草稿");
    await page.evaluate(() => {
      window.noLinkOutboundFixture.mode = "unknown";
    });
    await page.getByRole("button", { name: "傳送回覆", exact: true }).click();
    await expect(page.getByRole("button", { name: "核對傳送狀態", exact: true })).toBeVisible();
    await page.evaluate(() => {
      const key = Object.keys(sessionStorage).find((k) => k.includes(":outbound:"));
      sessionStorage.setItem(key, "{corrupt");
    });
    await page.reload();
    await page.getByRole("button", { name: "核對傳送狀態", exact: true }).click();
    await expect(page.getByRole("button", { name: "傳送回覆", exact: true })).toBeDisabled();
    await expect(page.getByLabel("WhatsApp 回覆").filter({ visible: true })).toHaveValue(
      "合成保留草稿",
    );
    expect(await page.evaluate(() => window.noLinkOutboundFixture.calls.length)).toBe(0);
  });
  await check(
    "outbound known failure allows only a new deliberate send after readback",
    390,
    async (page) => {
      await open(page, url(ids.a));
      const input = page.getByLabel("WhatsApp 回覆").filter({ visible: true });
      await input.fill("合成核對失敗後的草稿");
      await page.evaluate(() => {
        window.noLinkOutboundFixture.mode = "unknown";
      });
      await page.getByRole("button", { name: "傳送回覆", exact: true }).click();
      await expect(page.getByRole("button", { name: "核對傳送狀態", exact: true })).toBeVisible();
      await page.evaluate(() => {
        const entries = JSON.parse(sessionStorage.getItem("no-link-fixture-outbound"));
        entries[0].state = "failed";
        sessionStorage.setItem("no-link-fixture-outbound", JSON.stringify(entries));
        window.noLinkOutboundFixture.mode = "ok";
      });
      await page.getByRole("button", { name: "核對傳送狀態", exact: true }).click();
      await expect(input).toHaveValue("合成核對失敗後的草稿");
      await expect(page.getByRole("button", { name: "傳送回覆", exact: true })).toBeEnabled();
      expect(
        await page.evaluate(
          () => window.noLinkOutboundFixture.calls.filter((c) => c.name === "text").length,
        ),
      ).toBe(1);
      await page.getByRole("button", { name: "傳送回覆", exact: true }).click();
      await expect(input).toHaveValue("");
      const entries = await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("no-link-fixture-outbound")),
      );
      expect(entries.length).toBe(2);
      expect(entries[0].id).not.toBe(entries[1].id);
    },
  );
  await check("outbound late reply cannot erase next conversation draft", 1280, async (page) => {
    await open(page, url(ids.a));
    const input = page.getByLabel("WhatsApp 回覆").filter({ visible: true });
    await input.fill("甲盤正在傳送的合成回覆");
    await page.evaluate(() => {
      window.noLinkOutboundFixture.mode = "delay";
    });
    await page.getByRole("button", { name: "傳送回覆", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => Boolean(window.noLinkOutboundFixture.release)))
      .toBe(true);
    await page.getByRole("button").filter({ hasText: "合成客戶乙" }).click();
    await input.fill("乙盤保留的另一份草稿");
    await page.evaluate(() => window.noLinkOutboundFixture.release());
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    await expect(input).toHaveValue("乙盤保留的另一份草稿");
    await page.getByRole("button").filter({ hasText: "合成客戶甲" }).click();
    await expect(input).toHaveValue("甲盤正在傳送的合成回覆");
    await page.getByRole("button", { name: "核對傳送狀態", exact: true }).click();
    await expect(input).toHaveValue("");
    expect(
      await page.evaluate(
        () => window.noLinkOutboundFixture.calls.filter((c) => c.name === "text").length,
      ),
    ).toBe(1);
  });
  await check(
    "outbound template cancel pending choice and duplicate stay explicit",
    390,
    async (page) => {
      await page.addInitScript(() => {
        sessionStorage.setItem("no-link-fixture-window", "expired");
        sessionStorage.setItem("no-link-fixture-reply-template", "true");
      });
      await open(page, url(ids.a));
      const picker = page.getByLabel("選擇範本").filter({ visible: true });
      await picker.click();
      await page.getByRole("option", { name: "synthetic_reply（zh_HK）" }).click();
      await page.getByRole("button", { name: "傳送範本", exact: true }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "取消", exact: true })
        .click();
      expect(await page.evaluate(() => window.noLinkOutboundFixture.calls.length)).toBe(0);
      await page.evaluate(() => {
        window.noLinkOutboundFixture.mode = "delay";
      });
      await page.getByRole("button", { name: "傳送範本", exact: true }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "傳送", exact: true })
        .evaluate((button) => {
          button.click();
          button.click();
        });
      await expect
        .poll(() =>
          page.evaluate(
            () => window.noLinkOutboundFixture.calls.filter((c) => c.name === "template").length,
          ),
        )
        .toBe(1);
      await expect(picker).toBeDisabled();
      await expect(
        page.getByRole("alertdialog").getByRole("button", { name: "取消", exact: true }),
      ).toBeDisabled();
      await page.evaluate(() => window.noLinkOutboundFixture.release());
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
    },
  );
  await check("outbound empty reply and 1000 character boundary", 360, async (page) => {
    await open(page, url(ids.a));
    const input = page.getByLabel("WhatsApp 回覆").filter({ visible: true });
    await input.fill("   ");
    await expect(page.getByRole("button", { name: "傳送回覆", exact: true })).toBeDisabled();
    await expect(input).toHaveAttribute("maxlength", "1000");
    await input.fill("合".repeat(1000));
    await page.getByRole("button", { name: "傳送回覆", exact: true }).click();
    await expect(input).toHaveValue("");
    expect(
      await page.evaluate(
        () =>
          window.noLinkOutboundFixture.calls.find((c) => c.name === "text").input.data.text.length,
      ),
    ).toBe(1000);
  });
  await check(
    "outbound cold tab reads unresolved reservation before any new send",
    390,
    async (page) => {
      await page.addInitScript(() => {
        if (!sessionStorage.getItem("no-link-fixture-outbound"))
          sessionStorage.setItem(
            "no-link-fixture-outbound",
            JSON.stringify([
              {
                id: "70000000-0000-4000-8000-000000000001",
                conversationId: "10000000-0000-4000-8000-000000000001",
                actor: "agent-a",
                kind: "text",
                state: "unknown",
                text: "合成舊傳送結果待核對",
              },
            ]),
          );
      });
      await open(page, url(ids.a));
      const input = page.getByLabel("WhatsApp 回覆").filter({ visible: true });
      await expect(input).toBeDisabled();
      const recovery = page.getByRole("button", { name: "核對傳送狀態", exact: true });
      await expect(recovery).toBeVisible();
      expect(
        await page.evaluate(() => window.noLinkOutboundFixture.reservationReads.length),
      ).toBeGreaterThan(0);
      await recovery.click();
      await expect(input).toBeDisabled();
      expect(
        await page.evaluate(
          () =>
            window.noLinkOutboundFixture.calls.filter((c) => ["text", "template"].includes(c.name))
              .length,
        ),
      ).toBe(0);
      await page.reload();
      await expect(input).toBeDisabled();
      await page.evaluate(() => {
        const records = JSON.parse(sessionStorage.getItem("no-link-fixture-outbound"));
        records[0].state = "accepted";
        sessionStorage.setItem("no-link-fixture-outbound", JSON.stringify(records));
      });
      await recovery.click();
      await expect(input).toBeEnabled();
      await input.fill("合成核對後的新內容");
      await page.getByRole("button", { name: "傳送回覆", exact: true }).click();
      await expect(input).toHaveValue("");
      expect(
        await page.evaluate(
          () => window.noLinkOutboundFixture.calls.filter((c) => c.name === "text").length,
        ),
      ).toBe(1);
    },
  );
  await check(
    "outbound another tab reservation rejects new request without journalling a nonexistent send",
    768,
    async (page) => {
      await open(page, url(ids.a));
      const input = page.getByLabel("WhatsApp 回覆").filter({ visible: true });
      await input.fill("合成目前tab草稿保留");
      await page.evaluate(() =>
        sessionStorage.setItem(
          "no-link-fixture-outbound",
          JSON.stringify([
            {
              id: "70000000-0000-4000-8000-000000000002",
              conversationId: "10000000-0000-4000-8000-000000000001",
              actor: "agent-a",
              kind: "template",
              state: "dispatching",
              text: "合成另一tab正在處理",
            },
          ]),
        ),
      );
      await page.getByRole("button", { name: "傳送回覆", exact: true }).click();
      await expect(input).toHaveValue("合成目前tab草稿保留");
      await expect(input).toBeDisabled();
      expect(
        await page.evaluate(
          () => JSON.parse(sessionStorage.getItem("no-link-fixture-outbound")).length,
        ),
      ).toBe(1);
      expect(
        await page.evaluate(
          () => Object.keys(sessionStorage).filter((k) => k.startsWith("earnest:outbound:")).length,
        ),
      ).toBe(0);
      await page.getByRole("button", { name: "核對傳送狀態", exact: true }).click();
      await expect(input).toBeDisabled();
    },
  );
  await check(
    "outbound reservation read failure locks composer and retry is readonly",
    360,
    async (page) => {
      await page.addInitScript(() =>
        sessionStorage.setItem("no-link-fixture-reservation-failure", "true"),
      );
      await open(page, url(ids.a));
      const input = page.getByLabel("WhatsApp 回覆").filter({ visible: true });
      await expect(input).toBeDisabled();
      await page.getByRole("button", { name: "核對傳送狀態", exact: true }).click();
      await expect(input).toBeDisabled();
      await page.evaluate(() => sessionStorage.removeItem("no-link-fixture-reservation-failure"));
      await page.getByRole("button", { name: "核對傳送狀態", exact: true }).click();
      await expect(input).toBeEnabled();
      expect(
        await page.evaluate(
          () =>
            window.noLinkOutboundFixture.calls.filter((c) => ["text", "template"].includes(c.name))
              .length,
        ),
      ).toBe(0);
      expect(
        await page.evaluate(() => window.noLinkOutboundFixture.reservationReads.length),
      ).toBeGreaterThan(1);
    },
  );
  await check(
    "outbound unknown provider result requires reconciliation without retry advice",
    390,
    async (page) => {
      await page.addInitScript(() =>
        sessionStorage.setItem(
          "no-link-fixture-outbound",
          JSON.stringify([
            {
              id: "70000000-0000-4000-8000-000000000004",
              conversationId: "10000000-0000-4000-8000-000000000001",
              actor: "agent-a",
              kind: "text",
              state: "unknown",
              text: "合成供應商結果待核對",
            },
          ]),
        ),
      );
      await open(page, url(ids.a));
      const bubble = page
        .getByText("合成供應商結果待核對", { exact: true })
        .filter({ visible: true })
        .locator("..");
      await expect(bubble).toContainText("傳送結果未明");
      await expect(bubble).not.toContainText("請稍後重試");
      await expect(bubble).toContainText("先核對");
      expect(await page.evaluate(() => window.noLinkOutboundFixture.calls.length)).toBe(0);
    },
  );
  await check(
    "outbound cancelled reservation explains no send with visible alert",
    768,
    async (page) => {
      await page.addInitScript(() =>
        sessionStorage.setItem(
          "no-link-fixture-outbound",
          JSON.stringify([
            {
              id: "70000000-0000-4000-8000-000000000005",
              conversationId: "10000000-0000-4000-8000-000000000001",
              actor: "agent-a",
              kind: "text",
              state: "cancelled",
              text: "合成被取消的未送出要求",
              error: "OUTBOUND_RECONCILIATION_REQUIRED",
            },
          ]),
        ),
      );
      await open(page, url(ids.a));
      const bubble = page
        .getByText("合成被取消的未送出要求", { exact: true })
        .filter({ visible: true })
        .locator("..");
      await expect(bubble).toHaveAttribute("role", "alert");
      await expect(bubble).toContainText("未送出");
      await expect(bubble).not.toContainText("OUTBOUND_RECONCILIATION_REQUIRED");
      expect(await page.evaluate(() => window.noLinkOutboundFixture.calls.length)).toBe(0);
    },
  );
  for (const width of [390, 768, 1280, 1440]) {
    const analyticsUrl = `${origin}/admin/analytics?start=2026-09-30&end=2026-09-30&cohortWindowDays=30`;
    await check(
      "analytics KPI drilldown and visible CSV match scoped Hong Kong cohort",
      width,
      async (page) => {
        await open(page, analyticsUrl);
        const dashboard = page.getByRole("region", { name: "銷售及代理績效" });
        const card = (label) =>
          dashboard
            .locator("div.rounded-lg.border.bg-card")
            .filter({ has: page.getByRole("heading", { name: label, exact: true }) });
        await expect(card("有效查詢").locator("p").first()).toHaveText("3");
        await card("有效查詢").getByRole("button", { name: "可查看記錄" }).click();
        const records = page.getByRole("region", { name: "對應記錄" });
        await expect(records.locator("tbody tr")).toHaveCount(3);
        const visibleIds = await records
          .locator("tbody tr")
          .evaluateAll((rows) => rows.map((row) => row.textContent));
        const downloadReady = page.waitForEvent("download");
        await records.getByRole("button", { name: /匯出/ }).click();
        const csv = await readFile(await (await downloadReady).path(), "utf8");
        expect(csv.trim().split("\r\n")).toHaveLength(4);
        for (const n of [1, 2, 3])
          expect(csv).toContain(`80000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
        for (const n of [4, 5, 6, 7, 8])
          expect(csv).not.toContain(`80000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
        expect(visibleIds).toHaveLength(3);
        await dashboard.getByRole("tab", { name: "來源證據" }).click();
        await expect(card("點擊至查詢比率")).toContainText("未有足夠資料");
        await expect(card("點擊至查詢比率")).not.toContainText("0%");
        await expect(card("點擊至查詢比率")).not.toContainText("100%");
        for (const label of ["28Hse 訊息來源", "有追蹤開啟證據的查詢", "來源未核實"])
          await expect(card(label).locator("p").first()).toHaveText("1");
        await dashboard.getByRole("tab", { name: "回覆及跟進" }).click();
        await expect(card("已確認分配").locator("p").first()).toHaveText("1");
        await expect(card("未回覆").locator("p").first()).toHaveText("2");
        await expect(card("首回覆中位數").locator("p").first()).toHaveText("15 分鐘");
        await dashboard.getByRole("tab", { name: "成交及佣金" }).click();
        await expect(card("已核實成交").locator("p").first()).toHaveText("2");
        await expect(card("買賣成交額").locator("p").first()).toHaveText("HK$10,000,000.00");
        await page.reload();
        await expect(card("有效查詢").locator("p").first()).toHaveText("3");
        await page.locator("#performance-source").selectOption("28hse");
        await page.getByRole("button", { name: "套用篩選" }).click();
        await expect(card("有效查詢").locator("p").first()).toHaveText("1");
        await card("有效查詢").getByRole("button", { name: "可查看記錄" }).click();
        await expect(records.locator("tbody tr")).toHaveCount(1);
      },
      "manager",
    );
  }
  for (const width of [390, 768, 1280, 1440]) {
    await check(
      "overview permission loss clears previous restricted counts",
      width,
      async (page) => {
        await open(page, origin + "/admin");
        const card = page.getByRole("link").filter({ hasText: "開放查詢" });
        await expect(card).toContainText("2");
        await page.evaluate(() => {
          window.noLinkFixture.failOverviewDenied = true;
        });
        await page.getByRole("button", { name: "重新整理", exact: true }).click();
        await expect(card.getByRole("alert")).toBeVisible();
        await expect(card).toContainText("—");
        await expect(card).not.toContainText("2");
      },
      "manager",
    );
    await check(
      "overview card opens the same two open leads with scope and as-of",
      width,
      async (page) => {
        await page.addInitScript(() => sessionStorage.setItem("no-link-fixture-overview", "true"));
        await open(page, origin + "/admin");
        await expect(page.getByText(/客戶資料範圍：全公司/)).toBeVisible();
        await expect(page.getByText(/資料截至.*香港時間/)).toBeVisible();
        const card = page.getByRole("link").filter({ hasText: "開放查詢" });
        await expect(card).toContainText("2");
        await card.click();
        await expect(page).toHaveURL(/stage=open/);
        await expect(page.getByText("顯示 2 筆 / 共 2 筆")).toBeVisible();
        expect(
          await page.evaluate(
            () =>
              window.noLinkFixture.calls
                .filter((c) => c.name === "page" && c.input.resource === "leads")
                .at(-1).input.stage,
          ),
        ).toBe("open");
        await page.reload();
        await expect(page.getByText("顯示 2 筆 / 共 2 筆")).toBeVisible();
      },
      "manager",
    );
    await check(
      "overview failed refresh retains last success with visible error, not false zero",
      width,
      async (page) => {
        await open(page, origin + "/admin");
        const card = page.getByRole("link").filter({ hasText: "開放查詢" });
        await expect(card).toContainText("2");
        await page.evaluate(() => {
          window.noLinkFixture.failOverview = true;
        });
        await page.getByRole("button", { name: "重新整理", exact: true }).click();
        await expect(card.getByRole("alert")).toBeVisible();
        await expect(card).toContainText("2");
        await expect(page.getByText(/資料截至.*香港時間/)).toBeVisible();
      },
      "manager",
    );
  }
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  await mkdir(".audit", { recursive: true });
  await writeFile(
    `.audit/${evidencePrefix}no-link-synthetic-browser-results.json`,
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
        syntheticCrmModel: true,
        syntheticEnquiryModel: true,
        syntheticCampaignModel: true,
        syntheticStaffWorkModel: true,
        syntheticOutboundModel: true,
        renderedControls: [...renderedControls.values()],
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
