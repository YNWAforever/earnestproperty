import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
/** Real React component in Chromium; synthetic API only, no auth or DB claims. */
import { chromium, expect } from "@playwright/test";
import { linkBatchProgressKey } from "../src/lib/admin/whatsapp-link-batch-client.ts";
const build = spawnSync("bun", ["scripts/browser-fixtures/build-whatsapp-link-handoff.ts"], {
  stdio: "inherit",
});
if (build.status !== 0) throw Error("Fixture bundle failed");
const codeSha = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
const bundle = readFileSync(".audit/whatsapp-link-handoff-bundle.js", "utf8");
const httpServer = createServer((request, response) => {
  response.setHeader(
    "Content-Type",
    request.url === "/fixture.js" ? "text/javascript" : "text/html",
  );
  response.end(
    request.url === "/fixture.js"
      ? bundle
      : '<!doctype html><html lang="zh-HK"><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>',
  );
});
await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
const address = httpServer.address() as { port: number };
const server = { url: new URL(`http://127.0.0.1:${address.port}`), stop: () => httpServer.close() };
const browser = await chromium.launch();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const offer = {
  propertyId: id(1),
  publicListingNo: "A074714",
  dealType: "sale",
  title: "合成樓盤",
  price: 6000000,
  agentId: null,
  agentName: null,
};
const previous = {
  batchId: id(2),
  rows: [
    {
      rowKey: id(3),
      placementId: "website:primary",
      input: {
        entryPointType: "reception",
        placementSource: "website",
        enabled: true,
        placementVerified: true,
      },
    },
  ],
  chunkIds: [id(4)],
  nextChunk: 0,
  completed: [],
  uncertain: false,
  preview: {
    batchId: id(2),
    previewToken: id(5),
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    rows: [{ rowKey: id(3), decision: "create", reasons: [] }],
    counts: { create: 1, reuse: 0, blocked: 0 },
  },
};
let passed = 0,
  failed = 0;
const results: { name: string; width: number; status: string; error?: string }[] = [];
async function check(
  name: string,
  saved: unknown,
  run: (page: import("@playwright/test").Page) => Promise<void>,
  width = 1280,
) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  try {
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === server.url.origin
        ? route.continue()
        : route.abort(),
    );
    await page.addInitScript(
      ({ key, value }) => {
        if (value && !sessionStorage.getItem(key))
          sessionStorage.setItem(key, JSON.stringify(value));
      },
      { key: linkBatchProgressKey("fixture-admin"), value: saved },
    );
    await page.goto(server.url.toString());
    await page.waitForFunction(() =>
      Boolean((window as unknown as { fixtureReady: boolean }).fixtureReady),
    );
    await run(page);
    passed++;
    results.push({ name, width, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    results.push({
      name,
      width,
      status: "FAIL",
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : error}`);
  } finally {
    await page.close();
  }
}
const inject = async (page: import("@playwright/test").Page) =>
  page.evaluate(
    (value) =>
      (window as unknown as { injectSelection: (offers: unknown[]) => void }).injectSelection([
        value,
      ]),
    offer,
  );
try {
  await check("fresh listing selection is visible", null, async (page) => {
    await inject(page);
    await expect(page.getByText(/A074714/)).toBeVisible();
    await expect(page.getByRole("button", { name: "下一步：來源" })).toBeEnabled();
  });
  await check("new selection cannot disappear behind a saved preview", previous, async (page) => {
    await inject(page);
    await expect(page.getByText(/A074714/)).toBeVisible({ timeout: 1500 });
    await page.getByRole("button", { name: "使用這次選擇" }).click();
    await page.getByRole("button", { name: "下一步：來源" }).click();
    await page.getByLabel("已人工核對刊登位置").check();
    await page.getByRole("button", { name: "下一步：跟進" }).click();
    await page.getByRole("button", { name: "預覽核對", exact: true }).click();
    await expect(page.getByRole("button", { name: "確認建立 1 筆" })).toBeVisible();
  });
  await check(
    "unknown submission is preserved when a new selection arrives",
    { ...previous, uncertain: true },
    async (page) => {
      await inject(page);
      await expect(page.getByRole("button", { name: "使用這次選擇" })).toBeDisabled({
        timeout: 1500,
      });
      const saved = await page.evaluate(
        (key) => JSON.parse(sessionStorage.getItem(key)!),
        linkBatchProgressKey("fixture-admin"),
      );
      expect(saved.batchId).toBe(previous.batchId);
      expect(saved.uncertain).toBe(true);
    },
  );
  await check(
    "reload of a preview returns to confirmation, not an empty result",
    previous,
    async (page) => {
      await expect(page.getByRole("button", { name: "確認建立 1 筆" })).toBeVisible({
        timeout: 1500,
      });
    },
  );

  await check(
    "empty lookup does not unlock an unknown submission",
    { ...previous, uncertain: true },
    async (page) => {
      await inject(page);
      await page.getByRole("button", { name: "查回伺服器結果" }).click();
      await expect(page.getByRole("button", { name: "使用這次選擇" })).toBeDisabled();
      await page.getByRole("button", { name: "繼續同一批次" }).click();
      await expect(page.getByRole("alert").first()).toContainText("結果仍未確認");
      expect(
        await page.evaluate(() => (window as unknown as { commitCalls?: number }).commitCalls ?? 0),
      ).toBe(0);
      expect(
        await page.evaluate(
          (key) => JSON.parse(sessionStorage.getItem(key)!).uncertain,
          linkBatchProgressKey("fixture-admin"),
        ),
      ).toBe(true);
    },
  );
  await check(
    "partial batch must finish before replacing selection",
    {
      ...previous,
      chunkIds: [id(4), id(6)],
      nextChunk: 1,
      completed: [{ batchId: id(2), chunkId: id(4), state: "committed", rows: [] }],
    },
    async (page) => {
      await inject(page);
      await expect(page.getByRole("button", { name: "使用這次選擇" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "繼續同一批次" })).toBeEnabled();
    },
  );
  await check(
    "known rejected batch permits a new selection",
    {
      ...previous,
      chunkIds: [id(4), id(6)],
      nextChunk: 1,
      completed: [{ batchId: id(2), chunkId: id(4), state: "rejected", rows: [] }],
    },
    async (page) => {
      await inject(page);
      await page.getByRole("button", { name: "使用這次選擇" }).click();
      await expect(page.getByRole("button", { name: "下一步：來源" })).toBeEnabled();
    },
  );
  await check("editing a restored preview returns to source step", previous, async (page) => {
    await page.getByRole("button", { name: "修改設定" }).click();
    await expect(page.getByRole("button", { name: "下一步：跟進" })).toBeVisible({ timeout: 1500 });
  });
  await check("one blocked row permits a freshly previewed 59-row subset", null, async (page) => {
    await page.evaluate(() => {
      (window as unknown as { blockLastRow: boolean }).blockLastRow = true;
    });
    const offers = Array.from({ length: 60 }, (_, index) => ({
      ...offer,
      propertyId: id(index + 1000),
      publicListingNo: `A${String(index + 1).padStart(6, "0")}`,
    }));
    await page.evaluate(
      (value) =>
        (window as unknown as { injectSelection: (offers: unknown[]) => void }).injectSelection(
          value,
        ),
      offers,
    );
    await page.getByRole("button", { name: "下一步：來源" }).click();
    await page.getByLabel("已人工核對刊登位置").check();
    await page.getByRole("button", { name: "下一步：跟進" }).click();
    await page.getByRole("button", { name: "預覽核對", exact: true }).click();
    await expect(page.getByText(/阻止 1/)).toBeVisible();
    await expect(page.getByRole("button", { name: "確認建立 60 筆" })).toBeDisabled();
    const before = await page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key)!).batchId,
      linkBatchProgressKey("fixture-admin"),
    );
    await page.getByLabel("我已核對並確認只處理所選合格行").check();
    await page.getByRole("button", { name: /只提交已核對的合格行/ }).click();
    await expect(page.getByRole("button", { name: "確認建立 59 筆" })).toBeEnabled();
    const after = await page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key)!).batchId,
      linkBatchProgressKey("fixture-admin"),
    );
    expect(after).not.toBe(before);
  });
  const csv50 =
    "public_listing_no,deal_type,source,placement_url_or_id,staff_reference\n" +
    Array.from(
      { length: 50 },
      (_, index) =>
        `A${String(index + 1).padStart(6, "0")},${index % 2 ? "rent" : "sale"},website,website:primary,website/synthetic|001-A`,
    ).join("\n");
  for (const width of [390, 768, 1280, 1440]) {
    await check(
      "fifty-row CSV validates, commits once, reloads and exports each outcome",
      null,
      async (page) => {
        await page.evaluate(() => Object.assign(window, { bulkImport: true, bulkCommit: true }));
        const input = page.getByLabel("CSV 或貼表格資料");
        // Duplicate and invalid input stay editable and never reach the lookup/commit.
        await input.fill(
          csv50.replace("A000002,rent", "A000001,sale").replace("A000003,sale", "A000003,invalid"),
        );
        await expect(page.getByRole("button", { name: /核對並匯入 \d+ 行/ })).toBeDisabled();
        await expect(page.getByRole("alert")).toContainText("重複行");
        await expect(page.getByRole("alert")).toContainText("租售類型只接受");
        await input.fill(csv50);
        await page.evaluate(() => Object.assign(window, { missingOffer: "A000048" }));
        await page.getByRole("button", { name: "核對並匯入 50 行" }).click();
        await expect(page.getByRole("alert")).toContainText("找不到現時公開");
        await expect(input).toHaveValue(csv50);
        await page.evaluate(() =>
          Object.assign(window, { missingOffer: null, bulkImportDenied: true }),
        );
        await page.getByRole("button", { name: "核對並匯入 50 行" }).click();
        await expect(page.getByRole("alert")).toContainText("無法查對目前公開租售盤");
        await page.evaluate(() => Object.assign(window, { bulkImportDenied: false }));
        await page.getByRole("button", { name: "核對並匯入 50 行" }).click();
        await page.getByLabel("已人工核對刊登位置").check();
        await page.getByRole("button", { name: "下一步：跟進" }).click();
        await page.getByRole("button", { name: "預覽核對", exact: true }).click();
        await page.getByRole("button", { name: "確認建立 50 筆" }).click();
        const result = page.getByRole("region", { name: "批次結果" });
        await expect(result).toContainText("已建立 40 · 重用 7 · 被阻止 1 · 失敗 2 · 未提交 0");
        await expect(result.locator("li")).toHaveCount(50);
        const successDownload = page.waitForEvent("download");
        await result.getByRole("button", { name: "匯出 website CSV", exact: true }).click();
        const successCsv = readFileSync((await (await successDownload).path())!, "utf8");
        expect(successCsv.trim().split("\r\n")).toHaveLength(48);
        expect(successCsv).toContain("A000001");
        expect(successCsv).toContain('"sale"');
        expect(successCsv).toContain('"rent"');
        const failureDownload = page.waitForEvent("download");
        await result
          .getByRole("button", { name: "匯出 website 已確認失敗 CSV", exact: true })
          .click();
        const failureCsv = readFileSync((await (await failureDownload).path())!, "utf8");
        expect(failureCsv.trim().split("\r\n")).toHaveLength(4);
        for (const value of [
          "A000048",
          "A000049",
          "A000050",
          "WA_LINK_VERSION_STALE",
          "WA_LINK_SCOPE_DENIED",
          "WA_LINK_STAFF_NOT_READY",
        ])
          expect(failureCsv).toContain(value);
        expect(failureCsv).not.toContain("/w/");
        const before = await page.evaluate(() =>
          JSON.parse(localStorage.getItem("fixture-batch-ops")!),
        );
        await page.reload();
        await expect(result.locator("li")).toHaveCount(50);
        await page.getByRole("button", { name: "查回伺服器結果" }).click();
        await expect(result).toContainText("已建立 40 · 重用 7 · 被阻止 1 · 失敗 2 · 未提交 0");
        expect(
          await page.evaluate(() => JSON.parse(localStorage.getItem("fixture-batch-ops")!)),
        ).toEqual(before);
        expect(
          await page.evaluate(
            () => (window as unknown as { commitCalls?: number }).commitCalls ?? 0,
          ),
        ).toBe(0);
        await page.getByRole("button", { name: "只修正已知失敗的 3 行" }).click();
        await expect(page.getByText(/已匯入 3 行 · 3 筆租售/)).toBeVisible();
      },
      width,
    );
  }
  const fiftyRows = Array.from({ length: 50 }, (_, index) => ({
    rowKey: id(3000 + index),
    placementId: "website:primary",
    input: {
      entryPointType: "sales",
      placementSource: "website",
      enabled: true,
      placementVerified: true,
      propertyId: id(1000 + index),
      publicListingNo: `A${String(index + 1).padStart(6, "0")}`,
      dealType: index % 2 ? "rent" : "sale",
    },
  }));
  const fiftyPreview = {
    ...previous,
    rows: fiftyRows,
    preview: {
      ...previous.preview,
      rows: fiftyRows.map((row) => ({ rowKey: row.rowKey, decision: "create", reasons: [] })),
      counts: { create: 50, reuse: 0, blocked: 0 },
    },
  };
  await check(
    "fifty-row unknown commit reload reconciles original operation without replaying successes",
    fiftyPreview,
    async (page) => {
      await page.evaluate(() =>
        Object.assign(window, { bulkCommit: true, bulkLoseResponseOnce: true, bulkReadFail: true }),
      );
      await page.getByRole("button", { name: "確認建立 50 筆" }).click();
      await expect(page.getByRole("region", { name: "批次結果" })).toContainText("未提交 50");
      await expect(page.getByRole("region", { name: "批次結果" })).toContainText("結果未確認");
      expect(
        await page.evaluate(() => JSON.parse(localStorage.getItem("fixture-batch-ops")!).length),
      ).toBe(1);
      await page.reload();
      await page.getByRole("button", { name: "查回伺服器結果" }).click();
      await expect(page.getByRole("region", { name: "批次結果" })).toContainText(
        "已建立 40 · 重用 7 · 被阻止 1 · 失敗 2 · 未提交 0",
      );
      expect(
        await page.evaluate(() => (window as unknown as { commitCalls?: number }).commitCalls ?? 0),
      ).toBe(0);
      expect(
        await page.evaluate(() => JSON.parse(localStorage.getItem("fixture-batch-ops")!).length),
      ).toBe(1);
    },
    390,
  );
} finally {
  await browser.close();
  server.stop();
}
writeFileSync(
  ".audit/whatsapp-link-handoff-results.json",
  JSON.stringify(
    {
      environment: {
        ownedLoopback: true,
        realComponent: true,
        syntheticAPI: true,
        realAuth: false,
        database: false,
        providerSend: false,
      },
      codeSha,
      results,
      passed,
      failed,
      skipped: 0,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ passed, failed, skipped: 0 }));
if (failed) process.exitCode = 1;
