import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
import type { state } from "../scripts/browser-fixtures/link-bulk-owned/synthetic-batches";
declare global {
  interface Window {
    ownedLinkBulk: typeof state;
    ownedClipboard: { texts: string[]; mode: string; release: null | (() => void) };
  }
}
let server: Server, origin: string;
const results: { name: string; status: string; width: number }[] = [];
test.beforeAll(async () => {
  test.setTimeout(120000);
  assert.ok(!process.env.PLAYWRIGHT_BASE_URL);
  assert.equal(
    spawnSync(process.execPath, ["scripts/browser-fixtures/build-admin-link-bulk-owned.mjs"], {
      stdio: "inherit",
    }).status,
    0,
  );
  const root = resolve(".audit/link-bulk-owned-browser");
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
  await writeFile(
    ".audit/remediation-20261003/ep13-20-link-membership-browser-summary.json",
    JSON.stringify(
      {
        codeSha: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
        evidenceLayer:
          "actual-link-route-wizard-import-results-shell-staff-store-synthetic-auth-api-owned-loopback",
        realAuth: false,
        realDatabase: false,
        realProvider: false,
        results,
      },
      null,
      2,
    ),
  );
});
test.afterEach(async ({ page }, info) => {
  const fits =
    info.status !== "passed" ||
    (await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  results.push({
    name: info.title,
    status: fits ? (info.status ?? "unknown") : "failed",
    width: page.viewportSize()!.width,
  });
  if (!fits) {
    console.log(
      "Bulk overflow",
      await page.evaluate(() => ({
        width: innerWidth,
        pageWidth: document.documentElement.scrollWidth,
        elements: [
          ...document.querySelectorAll(
            "#root code, #root p, #root textarea, #root section, #root input, #root select, #root form, #root button",
          ),
        ]
          .map((el) => ({
            tag: el.tagName,
            class: el.className,
            right: el.getBoundingClientRect().right,
            width: el.getBoundingClientRect().width,
            text: el.textContent?.slice(0, 90),
          }))
          .filter((el) => el.right > innerWidth)
          .slice(0, 12),
      })),
    );
    await page.screenshot({
      path: `.audit/remediation-20261003/ep13-20-bulk-overflow-${page.viewportSize()!.width}.png`,
    });
  }
  expect(fits).toBe(true);
  if (info.status === "passed" && info.title.startsWith("new batch reload"))
    await page.screenshot({
      path: `.audit/remediation-20261003/ep13-20-bulk-continuation-import-green-${page.viewportSize()!.width}.png`,
    });
});
const csv = (count = 50) =>
  "public_listing_no,deal_type,source,placement_url_or_id,staff_reference\n" +
  Array.from(
    { length: count },
    (_, i) =>
      `A${String(i + 1).padStart(6, "0")},${i % 2 ? "rent" : "sale"},${i % 2 ? "28hse" : "website"},${i % 2 ? String(4000001 + i) : ""},${i % 2 ? "28hse" : "website"}/account540|001-A`,
  ).join("\n");
async function downloaded(page: Page, name: string) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name, exact: true }).click();
  const file = await waiting;
  return readFile((await file.path())!, "utf8");
}
async function editFormulaPlacement(page: Page) {
  const row = page.getByRole("listitem").filter({ hasText: "A000001" });
  await row.getByLabel("來源").selectOption("other");
  await row.getByLabel("查詢路線").selectOption("");
  await row.getByLabel("投放 ID").fill('=中文,"測試"');
  await row.getByLabel("已核對此行投放位置").check();
  await expect(page.getByRole("button", { name: "確認建立 50 筆" })).toBeDisabled();
  await page.getByRole("button", { name: "重新預覽修正", exact: true }).click();
  await expect(page.getByRole("button", { name: "確認建立 50 筆" })).toBeEnabled();
}
async function draftRows(page: Page) {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith("earnest:whatsapp-link-draft:v1:"))
      .flatMap(
        (k) =>
          JSON.parse(localStorage.getItem(k)!).rows as { input: { publicListingNo: string } }[],
      )
      .map((r) => r.input.publicListingNo),
  );
}
async function setup(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.route("**/*", (route) =>
    route
      .request()
      .url()
      .startsWith(origin + "/")
      ? route.continue()
      : route.abort(),
  );
  await page.goto(origin + "/admin/whatsapp-links");
  await expect(page.getByRole("heading", { name: "建立 WhatsApp 連結" })).toBeVisible();
}
async function previewFifty(page: Page) {
  await page.getByLabel("CSV 或貼表格資料").fill(csv());
  await page.getByRole("button", { name: "核對並匯入 50 行" }).click();
  await expect(page.getByText("已匯入 50 行", { exact: false })).toBeVisible();
  await page.getByLabel("已人工核對刊登位置").check();
  await page.getByRole("button", { name: "下一步：跟進" }).click();
  await page.getByRole("button", { name: "預覽核對", exact: true }).click();
  await expect(page.getByRole("button", { name: "確認建立 50 筆" })).toBeVisible();
}
async function clipboardSink(page: Page, mode = "ok") {
  await page.evaluate((mode) => {
    window.ownedClipboard = { texts: [], mode, release: null };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          window.ownedClipboard.texts.push(text);
          if (window.ownedClipboard.mode === "denied")
            throw new DOMException("Owned clipboard denied", "NotAllowedError");
          if (window.ownedClipboard.mode === "pending")
            await new Promise<void>((done) => {
              window.ownedClipboard.release = done;
            });
        },
      },
    });
  }, mode);
}
async function recoverFirstFifty(page: Page) {
  await page.getByLabel("CSV 或貼表格資料").fill(csv(60));
  await page.getByRole("button", { name: "核對並匯入 60 行" }).click();
  await page.getByLabel("已人工核對刊登位置").check();
  await page.getByRole("button", { name: "下一步：跟進" }).click();
  await page.getByRole("button", { name: "預覽核對", exact: true }).click();
  await page.evaluate(() =>
    Object.assign(window.ownedLinkBulk, { commitMode: "lost", readFailure: true }),
  );
  await page.getByRole("button", { name: "確認建立 60 筆" }).click();
  await expect(page.getByRole("region", { name: "批次結果" })).toContainText("未提交 60");
  await page.reload();
  await page.getByRole("button", { name: "查回伺服器結果", exact: true }).click();
  await expect(page.getByRole("region", { name: "批次結果" })).toContainText("已建立 50");
  await expect(page.getByRole("region", { name: "批次結果" })).toContainText("未提交 10");
}
async function continueFinalTen(page: Page) {
  const stored = await page.evaluate(() =>
    JSON.parse(
      sessionStorage.getItem(
        Object.keys(sessionStorage).find((k) => k.startsWith("earnest:whatsapp-link-batch:v2:"))!,
      )!,
    ),
  );
  await page.getByRole("button", { name: "繼續同一批次", exact: true }).click();
  await expect(page.getByRole("region", { name: "批次結果" })).toContainText("已建立 60");
  await expect(page.getByRole("region", { name: "批次結果" })).toContainText("已處理 2/2 批");
  const commits = await page.evaluate(() =>
    window.ownedLinkBulk.calls
      .filter((c) => c.name === "commit")
      .map((c) => c.input as { batchId: string; chunkId: string; rows: unknown[] }),
  );
  expect(commits.map((c) => c.rows.length)).toEqual([50, 10]);
  expect(commits.map((c) => c.batchId)).toEqual([stored.batchId, stored.batchId]);
  expect(commits.map((c) => c.chunkId)).toEqual(stored.chunkIds);
  expect(await draftRows(page)).toEqual([]);
}
for (const width of [1440, 1280, 768, 390]) {
  test(`membership narrows link workspace without deleting the original batch journal ${width}`, async ({
    page,
  }) => {
    await setup(page, width);
    await previewFifty(page);
    const drafts = await draftRows(page);
    expect(drafts).toHaveLength(50);
    await page.evaluate(() => window.ownedLinkBulk.changeMembership("agent"));
    await expect(page.getByRole("heading", { name: "建立 WhatsApp 連結" })).toHaveCount(0);
    expect(await draftRows(page)).toEqual(drafts);
  });
  test(`membership change stops the next chunk after accepting the original fifty ${width}`, async ({
    page,
  }) => {
    await setup(page, width);
    await page.getByLabel("CSV 或貼表格資料").fill(csv(60));
    await page.getByRole("button", { name: "核對並匯入 60 行" }).click();
    await page.getByLabel("已人工核對刊登位置").check();
    await page.getByRole("button", { name: "下一步：跟進" }).click();
    await page.getByRole("button", { name: "預覽核對", exact: true }).click();
    await page.evaluate(() => {
      window.ownedLinkBulk.commitMode = "pending";
    });
    await page.getByRole("button", { name: "確認建立 60 筆" }).click();
    await expect
      .poll(() => page.evaluate(() => typeof window.ownedLinkBulk.releaseCommit === "function"))
      .toBe(true);
    await page.evaluate(() => window.ownedLinkBulk.changeMembership("agent"));
    await page.evaluate(() => {
      window.ownedLinkBulk.commitMode = "ok";
      window.ownedLinkBulk.releaseCommit!();
    });
    await expect.poll(() => page.evaluate(() => window.ownedLinkBulk.operations.length)).toBe(1);
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    expect(
      await page.evaluate(() => window.ownedLinkBulk.calls.filter((c) => c.name === "commit")),
    ).toHaveLength(1);
    expect(await page.evaluate(() => window.ownedLinkBulk.operations[0].rows)).toHaveLength(50);
  });

  test(`copy-all failure reports refusal then copies exactly fifty confirmed codes ${width}`, async ({
    page,
  }) => {
    await setup(page, width);
    await previewFifty(page);
    await page.getByRole("button", { name: "確認建立 50 筆" }).click();
    await clipboardSink(page, "denied");
    await page.getByRole("button", { name: "複製全部已確認連結", exact: true }).click();
    await expect(page.getByText("複製失敗，請逐行選取連結。", { exact: true })).toBeVisible();
    await page.evaluate(() => {
      window.ownedClipboard.mode = "ok";
    });
    await page.getByRole("button", { name: "複製全部已確認連結", exact: true }).click();
    await expect(page.getByText("已複製全部已確認連結。", { exact: true })).toBeVisible();
    const text = await page.evaluate(() => window.ownedClipboard.texts.at(-1)!);
    expect(text.split("\n")).toEqual(
      Array.from({ length: 50 }, (_, i) => `${origin}/w/owned_${String(i + 1).padStart(26, "0")}`),
    );
    expect(
      await page.evaluate(
        () => window.ownedLinkBulk.calls.filter((c) => c.name === "commit").length,
      ),
    ).toBe(1);
  });
  test(`normal fifty-plus-ten continuation clears earlier clipboard success ${width}`, async ({
    page,
  }) => {
    await setup(page, width);
    await recoverFirstFifty(page);
    await clipboardSink(page);
    await page.getByRole("button", { name: "複製全部已確認連結", exact: true }).click();
    await expect(page.getByText("已複製全部已確認連結。", { exact: true })).toBeVisible();
    expect((await page.evaluate(() => window.ownedClipboard.texts[0])).split("\n")).toHaveLength(
      50,
    );
    await continueFinalTen(page);
    await expect(page.getByText("已複製全部已確認連結。", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "複製全部已確認連結", exact: true }).click();
    await expect(page.getByText("已複製全部已確認連結。", { exact: true })).toBeVisible();
    const text = await page.evaluate(() => window.ownedClipboard.texts.at(-1)!);
    expect(text.split("\n")).toEqual(
      Array.from({ length: 60 }, (_, i) => `${origin}/w/owned_${String(i + 1).padStart(26, "0")}`),
    );
    await page.reload();
    await page.getByRole("button", { name: "查回伺服器結果", exact: true }).click();
    await expect(page.getByRole("region", { name: "批次結果" })).toContainText("已建立 60");
    expect(
      await page.evaluate(
        () => window.ownedLinkBulk.calls.filter((c) => c.name === "commit").length,
      ),
    ).toBe(2);
  });
  test(`late fifty-link clipboard completion cannot confirm the new sixty-link result ${width}`, async ({
    page,
  }) => {
    await setup(page, width);
    await recoverFirstFifty(page);
    await clipboardSink(page, "pending");
    await page.getByRole("button", { name: "複製全部已確認連結", exact: true }).click();
    await expect.poll(() => page.evaluate(() => !!window.ownedClipboard.release)).toBe(true);
    await expect(
      page.getByRole("button", { name: "複製全部已確認連結", exact: true }),
    ).toBeDisabled();
    await continueFinalTen(page);
    await page.evaluate(() => window.ownedClipboard.release!());
    await expect(
      page.getByRole("button", { name: "複製全部已確認連結", exact: true }),
    ).toBeEnabled();
    await expect(page.getByText("已複製全部已確認連結。", { exact: true })).toHaveCount(0);
    expect((await page.evaluate(() => window.ownedClipboard.texts[0])).split("\n")).toHaveLength(
      50,
    );
  });
  test(`new batch reload excludes fifty completed import rows ${width}`, async ({ page }) => {
    await setup(page, width);
    await previewFifty(page);
    await page.getByRole("button", { name: "確認建立 50 筆" }).click();
    await expect(page.getByRole("region", { name: "批次結果" })).toContainText("已建立 50");
    await page.getByRole("button", { name: "開始新批次", exact: true }).click();
    await page.reload();
    await expect(page.getByLabel("CSV 或貼表格資料")).toBeVisible();
    await expect(page.getByText("已匯入 50 行", { exact: false })).toHaveCount(0);
    expect(
      await page.evaluate(
        () => window.ownedLinkBulk.calls.filter((c) => c.name === "commit").length,
      ),
    ).toBe(1);
  });
  test(`recovered fifty-row success is removed from durable draft ${width}`, async ({ page }) => {
    await setup(page, width);
    await previewFifty(page);
    await page.evaluate(() =>
      Object.assign(window.ownedLinkBulk, { commitMode: "lost", readFailure: true }),
    );
    await page.getByRole("button", { name: "確認建立 50 筆" }).click();
    await expect(page.getByRole("region", { name: "批次結果" })).toContainText("未提交 50");
    await expect(page.getByRole("button", { name: "開始新批次", exact: true })).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: "查回伺服器結果", exact: true }).click();
    await expect(page.getByRole("region", { name: "批次結果" })).toContainText("已建立 50");
    const saved = await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith("earnest:whatsapp-link-draft:v1:"))
        .map((k) => JSON.parse(localStorage.getItem(k)!).rows.length),
    );
    expect(saved).toEqual([]);
    expect(
      await page.evaluate(
        () => window.ownedLinkBulk.calls.filter((c) => c.name === "commit").length,
      ),
    ).toBe(1);
  });
  test(`fifty actual imported rows reconcile scoped CSV and verified aliases ${width}`, async ({
    page,
  }) => {
    await setup(page, width);
    await previewFifty(page);
    await editFormulaPlacement(page);
    await page.getByRole("button", { name: "確認建立 50 筆" }).click();
    const result = page.getByRole("region", { name: "批次結果" });
    await expect(result).toContainText("已建立 50 · 重用 0 · 被阻止 0 · 失敗 0 · 未提交 0");
    const website = await downloaded(page, "匯出 website CSV");
    const portal = await downloaded(page, "匯出 28hse CSV");
    const other = await downloaded(page, "匯出 other CSV");
    expect(website.trim().split("\r\n")).toHaveLength(25);
    expect(portal.trim().split("\r\n")).toHaveLength(26);
    expect(other.trim().split("\r\n")).toHaveLength(2);
    expect(other).toContain('"\'=中文,""測試"""');
    expect(other).toContain('"A000001"');
    for (let i = 1; i <= 50; i++) {
      const listing = `A${String(i).padStart(6, "0")}`;
      const text = i === 1 ? other : i % 2 ? website : portal;
      expect(text).toContain(listing);
      expect(text).toContain(`/w/owned_${String(i).padStart(26, "0")}`);
    }
    const importRead = await page.evaluate(
      () =>
        window.ownedLinkBulk.calls.find((c) => c.name === "resolveImport")!.input as {
          references: { externalReference: string }[];
        },
    );
    expect(importRead.references).toHaveLength(50);
    expect(importRead.references.every((r) => r.externalReference === "001-A")).toBe(true);
    expect(await draftRows(page)).toEqual([]);
    await page.screenshot({
      path: `.audit/remediation-20261003/ep13-20-bulk-continuation-green-${width}.png`,
    });
  });
  test(`pending confirmation stays single while results are unavailable ${width}`, async ({
    page,
  }) => {
    await setup(page, width);
    await previewFifty(page);
    await page.evaluate(() => {
      window.ownedLinkBulk.commitMode = "pending";
    });
    const confirmation = page.getByRole("button", { name: "確認建立 50 筆" });
    await confirmation.click();
    await expect(page.getByRole("button", { name: "查回伺服器結果", exact: true })).toBeDisabled();
    await expect(page.getByRole("region", { name: "批次結果" })).toContainText("未提交 50");
    await expect(page.getByRole("button", { name: "繼續同一批次", exact: true })).toBeDisabled();
    await page
      .getByRole("button", { name: "繼續同一批次", exact: true })
      .evaluate((button: HTMLButtonElement) => button.click());
    expect(
      await page.evaluate(
        () => window.ownedLinkBulk.calls.filter((c) => c.name === "commit").length,
      ),
    ).toBe(1);
    await page.evaluate(() => window.ownedLinkBulk.releaseCommit!());
    await expect(page.getByRole("region", { name: "批次結果" })).toContainText("已建立 50");
    expect(await draftRows(page)).toEqual([]);
  });
  test(`empty original-batch lookup after reload cannot authorize resubmission ${width}`, async ({
    page,
  }) => {
    await setup(page, width);
    await previewFifty(page);
    await page.evaluate(() => {
      window.ownedLinkBulk.commitMode = "pending";
    });
    await page.getByRole("button", { name: "確認建立 50 筆" }).click();
    await expect(page.getByRole("region", { name: "批次結果" })).toContainText("未提交 50");
    await page.reload();
    await page.getByRole("button", { name: "查回伺服器結果", exact: true }).click();
    await page.getByRole("button", { name: "繼續同一批次", exact: true }).click();
    await expect(page.getByText("提交結果仍未確認", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "開始新批次", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /匯出 .* CSV/ })).toHaveCount(0);
    expect(
      await page.evaluate(
        () => window.ownedLinkBulk.calls.filter((c) => c.name === "commit").length,
      ),
    ).toBe(1);
    expect(await draftRows(page)).toHaveLength(50);
  });
  test(`recovered forty-five successes retain exactly five deferred draft rows ${width}`, async ({
    page,
  }) => {
    await setup(page, width);
    await page.evaluate(() => {
      window.ownedLinkBulk.blockedTail = 5;
    });
    await previewFifty(page);
    await expect(page.getByRole("button", { name: "確認建立 50 筆" })).toBeDisabled();
    const subset = page.getByRole("button", {
      name: "只提交已核對的合格行：先重新預覽",
      exact: true,
    });
    await expect(subset).toBeDisabled();
    await page.getByLabel("我已核對並確認只處理所選合格行").check();
    await page.evaluate(() => {
      window.ownedLinkBulk.blockedTail = 0;
    });
    await subset.click();
    await page.evaluate(() =>
      Object.assign(window.ownedLinkBulk, { commitMode: "lost", readFailure: true }),
    );
    await page.getByRole("button", { name: "確認建立 45 筆" }).click();
    await expect(page.getByRole("region", { name: "批次結果" })).toContainText("未提交 45");
    await page.evaluate(() => {
      window.ownedLinkBulk.readFailure = false;
    });
    await page.getByRole("button", { name: "查回伺服器結果", exact: true }).click();
    await expect(page.getByRole("region", { name: "批次結果" })).toContainText("已建立 45");
    expect(await draftRows(page)).toEqual(["A000046", "A000047", "A000048", "A000049", "A000050"]);
    await page.getByRole("button", { name: "開始新批次", exact: true }).click();
    await expect(page.getByLabel("CSV 或貼表格資料")).toBeVisible();
    await page.getByLabel("CSV 或貼表格資料").fill(csv());
    await page.getByRole("button", { name: "核對並匯入 50 行" }).click();
    // A new draft must not overwrite the preserved five-row deferred draft.
    expect((await draftRows(page)).filter((n) => n === "A000046")).toHaveLength(2);
    expect(await draftRows(page)).toHaveLength(55);
    await page.evaluate(() => {
      window.ownedLinkBulk.commitMode = "ok";
    });
    await page.getByLabel("已人工核對刊登位置").check();
    await page.getByRole("button", { name: "下一步：跟進" }).click();
    await page.getByRole("button", { name: "預覽核對", exact: true }).click();
    await page.getByRole("button", { name: "確認建立 50 筆" }).click();
    await expect(page.getByRole("region", { name: "批次結果" })).toContainText("已建立 50");
    await page.getByRole("button", { name: "開始新批次", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "開啟未完成草稿（5 行）", exact: true }).click();
    await page.getByLabel("已人工核對刊登位置").check();
    await page.getByRole("button", { name: "下一步：跟進" }).click();
    await page.getByRole("button", { name: "預覽核對", exact: true }).click();
    const numbers = await page.getByRole("listitem").allTextContents();
    expect(numbers.join(" ")).toContain("A000046");
    expect(numbers.join(" ")).toContain("A000050");
    expect(numbers.join(" ")).not.toContain("A000001");
    await page.getByRole("button", { name: "確認建立 5 筆" }).click();
    await expect(page.getByRole("region", { name: "批次結果" })).toContainText("已建立 5");
    expect(await draftRows(page)).toEqual([]);
    expect(
      await page.evaluate(
        () => window.ownedLinkBulk.calls.filter((c) => c.name === "commit").length,
      ),
    ).toBe(3);
  });
  test(`terminal rejected draft preserves the latest inline repair through reload ${width}`, async ({
    page,
  }) => {
    await setup(page, width);
    await previewFifty(page);
    await editFormulaPlacement(page);
    await page.evaluate(() => {
      window.ownedLinkBulk.commitMode = "atomic-reject";
    });
    await page.getByRole("button", { name: "確認建立 50 筆" }).click();
    await expect(page.getByRole("region", { name: "批次結果" })).toContainText("失敗 45");
    const repaired = await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith("earnest:whatsapp-link-draft:v1:"))
        .flatMap((k) => JSON.parse(localStorage.getItem(k)!).rows)
        .find((r) => r.input.publicListingNo === "A000001"),
    );
    expect(repaired.placementId).toBe('=中文,"測試"');
    expect(repaired.input.placementSource).toBe("other");
    await page.reload();
    await page.getByRole("button", { name: "只修正已知失敗的 50 行", exact: true }).click();
    await page.getByLabel("已人工核對刊登位置").check();
    await page.getByRole("button", { name: "下一步：跟進" }).click();
    await page.getByRole("button", { name: "預覽核對", exact: true }).click();
    await expect(
      page.getByRole("listitem").filter({ hasText: "A000001" }).getByLabel("投放 ID"),
    ).toHaveValue('=中文,"測試"');
    await page.evaluate(() => {
      window.ownedLinkBulk.commitMode = "ok";
    });
    await page.getByRole("button", { name: "確認建立 50 筆" }).click();
    await expect(page.getByRole("region", { name: "批次結果" })).toContainText("已建立 50");
    expect(await draftRows(page)).toEqual([]);
    expect(
      await page.evaluate(
        () => window.ownedLinkBulk.calls.filter((c) => c.name === "commit").length,
      ),
    ).toBe(2);
  });
  for (const legacy of [false, true]) {
    test(`original batch receipt cleans its own draft after another tab changes the pointer ${legacy ? "legacy" : "current"} ${width}`, async ({
      page,
    }) => {
      await setup(page, width);
      await previewFifty(page);
      await page.evaluate(() =>
        Object.assign(window.ownedLinkBulk, { commitMode: "lost", readFailure: true }),
      );
      await page.getByRole("button", { name: "確認建立 50 筆" }).click();
      await expect(page.getByRole("region", { name: "批次結果" })).toContainText("未提交 50");
      const originalKey = await page.evaluate(
        () =>
          Object.keys(localStorage).find((k) => k.startsWith("earnest:whatsapp-link-draft:v1:"))!,
      );
      if (legacy)
        await page.evaluate(() => {
          const key = Object.keys(sessionStorage).find((k) =>
            k.startsWith("earnest:whatsapp-link-batch:v2:"),
          )!;
          const value = JSON.parse(sessionStorage.getItem(key)!);
          delete value.draftId;
          sessionStorage.setItem(key, JSON.stringify(value));
        });
      const otherTab = await page.context().newPage();
      await setup(otherTab, width);
      const other = await otherTab.evaluate((key) => {
        const original = JSON.parse(localStorage.getItem(key)!);
        const draftId = crypto.randomUUID();
        const rows = original.rows
          .slice(0, 5)
          .map((row: { rowKey: string; placementId: string }) => ({
            ...row,
            rowKey: crypto.randomUUID(),
            placementId: "other-tab-edited",
          }));
        const value = { ...original, draftId, rows };
        const otherKey = key.slice(0, key.lastIndexOf(":") + 1) + draftId;
        localStorage.setItem(otherKey, JSON.stringify(value));
        const pointer = Object.keys(localStorage).find((k) =>
          k.startsWith("earnest:whatsapp-link-draft-active:v1:"),
        )!;
        localStorage.setItem(pointer, draftId);
        return { otherKey, value };
      }, originalKey);
      await page.reload();
      await page.evaluate(() => {
        window.ownedLinkBulk.readFailure = false;
      });
      await page.getByRole("button", { name: "查回伺服器結果", exact: true }).click();
      await expect(page.getByRole("region", { name: "批次結果" })).toContainText("已建立 50");
      expect(await page.evaluate((key) => localStorage.getItem(key), originalKey)).toBeNull();
      expect(
        await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), other.otherKey),
      ).toEqual(other.value);
      expect(await draftRows(page)).toHaveLength(5);
      expect(
        await page.evaluate(
          () => window.ownedLinkBulk.calls.filter((c) => c.name === "commit").length,
        ),
      ).toBe(1);
      await otherTab.close();
    });
  }
  test(`storage write failure on reload preserves uncertain original batch recovery ${width}`, async ({
    page,
  }) => {
    await setup(page, width);
    await previewFifty(page);
    await page.evaluate(() =>
      Object.assign(window.ownedLinkBulk, { commitMode: "lost", readFailure: true }),
    );
    await page.getByRole("button", { name: "確認建立 50 筆" }).click();
    await expect(page.getByRole("region", { name: "批次結果" })).toContainText("未提交 50");
    const stored = await page.evaluate(() => {
      const key = Object.keys(sessionStorage).find((k) =>
        k.startsWith("earnest:whatsapp-link-batch:v2:"),
      )!;
      const value = JSON.parse(sessionStorage.getItem(key)!);
      delete value.draftId;
      const raw = JSON.stringify(value);
      sessionStorage.setItem(key, raw);
      return { key, raw };
    });
    await page.addInitScript(() => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("earnest:whatsapp-link-batch:v2:"))
          throw new DOMException("owned quota proof", "QuotaExceededError");
        write.call(this, key, value);
      };
    });
    await page.reload();
    await expect(page.getByRole("region", { name: "批次結果" })).toContainText("未提交 50");
    expect(await page.evaluate((key) => sessionStorage.getItem(key), stored.key)).toBe(stored.raw);
    await expect(page.getByRole("button", { name: "開始新批次", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "查回伺服器結果", exact: true }).click();
    expect(
      await page.evaluate(
        () => window.ownedLinkBulk.calls.filter((c) => c.name === "commit").length,
      ),
    ).toBe(1);
    expect(
      await page.evaluate(() => window.ownedLinkBulk.calls.filter((c) => c.name === "read").length),
    ).toBeGreaterThan(1);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), stored.key)).toBe(stored.raw);
  });
  test(`duplicate and invalid fifty-line CSV never reach lookup or preview ${width}`, async ({
    page,
  }) => {
    await setup(page, width);
    const lines = csv().split("\n");
    lines[50] = lines[49];
    await page.getByLabel("CSV 或貼表格資料").fill(lines.join("\n"));
    await expect(page.getByRole("alert").filter({ hasText: "第 51 行" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^核對並匯入/ })).toBeDisabled();
    await page
      .getByLabel("CSV 或貼表格資料")
      .fill(csv().replace("A000050,rent", "A000050,invalid"));
    await expect(page.getByRole("button", { name: /^核對並匯入/ })).toBeDisabled();
    expect(await page.evaluate(() => window.ownedLinkBulk.calls)).toEqual([]);
  });
  test(`denied exact staff aliases block fifty-row import without guessing names ${width}`, async ({
    page,
  }) => {
    await setup(page, width);
    await page.evaluate(() => {
      window.ownedLinkBulk.deniedReference = true;
    });
    await page.getByLabel("CSV 或貼表格資料").fill(csv());
    await page.getByRole("button", { name: "核對並匯入 50 行" }).click();
    await expect(page.getByRole("alert")).toContainText("同事");
    await expect(page.getByText("已匯入 50 行", { exact: false })).toHaveCount(0);
    expect(await page.evaluate(() => window.ownedLinkBulk.calls.map((c) => c.name))).toEqual([
      "resolveImport",
    ]);
  });
  test(`atomic rejected fifty-row chunk exports failures without invented successful links ${width}`, async ({
    page,
  }) => {
    await setup(page, width);
    await previewFifty(page);
    await editFormulaPlacement(page);
    await page.evaluate(() => {
      window.ownedLinkBulk.commitMode = "atomic-reject";
    });
    await page.getByRole("button", { name: "確認建立 50 筆" }).click();
    await expect(page.getByRole("region", { name: "批次結果" })).toContainText(
      "已建立 0 · 重用 0 · 被阻止 5 · 失敗 45 · 未提交 0",
    );
    await expect(page.getByRole("button", { name: "複製全部已確認連結", exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "只修正已知失敗的 50 行", exact: true }),
    ).toBeVisible();
    const texts: string[] = [];
    for (const source of ["website", "28hse", "other"])
      texts.push(await downloaded(page, `匯出 ${source} 已確認失敗 CSV`));
    expect(texts.map((t) => t.trim().split("\r\n").length)).toEqual([25, 26, 2]);
    expect(texts.join("")).not.toContain("/w/");
    expect(texts.join("")).toContain("CHUNK_NOT_COMMITTED");
    expect(texts.join("")).toContain("WA_LINK_STAFF_NOT_READY");
    expect(texts[2]).toContain('"\'=中文,""測試"""');
    expect(await draftRows(page)).toHaveLength(50);
  });
  test(`another actor cannot restore the first actor's fifty-row pending draft ${width}`, async ({
    page,
  }) => {
    await setup(page, width);
    await previewFifty(page);
    await page.evaluate(() =>
      sessionStorage.setItem("owned-link-bulk-actor", "owned-bulk-manager-b"),
    );
    await page.reload();
    await expect(page.getByLabel("CSV 或貼表格資料")).toBeVisible();
    await expect(page.getByRole("button", { name: "確認建立 50 筆" })).toHaveCount(0);
    expect(await draftRows(page)).toHaveLength(50);
    expect(
      await page.evaluate(
        () => window.ownedLinkBulk.calls.filter((c) => ["read", "commit"].includes(c.name)).length,
      ),
    ).toBe(0);
  });
}
