import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
/** Real React component in Chromium; synthetic API only, no auth or DB claims. */
import { chromium, expect } from "@playwright/test";
import { linkBatchProgressKey } from "../src/lib/admin/whatsapp-link-batch-client.ts";
const build = spawnSync("bun", ["scripts/browser-fixtures/build-whatsapp-link-handoff.ts"], {
  stdio: "inherit",
});
if (build.status !== 0) throw Error("Fixture bundle failed");
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
async function check(
  name: string,
  saved: unknown,
  run: (page: import("@playwright/test").Page) => Promise<void>,
) {
  const page = await browser.newPage();
  try {
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === server.url.origin
        ? route.continue()
        : route.abort(),
    );
    await page.addInitScript(
      ({ key, value }) => {
        if (value) sessionStorage.setItem(key, JSON.stringify(value));
      },
      { key: linkBatchProgressKey, value: saved },
    );
    await page.goto(server.url.toString());
    await page.waitForFunction(() =>
      Boolean((window as unknown as { fixtureReady: boolean }).fixtureReady),
    );
    await run(page);
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
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
        linkBatchProgressKey,
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
      expect(
        await page.evaluate(
          (key) => JSON.parse(sessionStorage.getItem(key)!).uncertain,
          linkBatchProgressKey,
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
  await check("editing a restored preview starts at selection", previous, async (page) => {
    await page.getByRole("button", { name: "修改設定" }).click();
    await expect(page.getByRole("button", { name: "下一步：來源" })).toBeVisible({ timeout: 1500 });
  });
} finally {
  await browser.close();
  server.stop();
}
console.log(JSON.stringify({ passed, failed, skipped: 0 }));
if (failed) process.exitCode = 1;
