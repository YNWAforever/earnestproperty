import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { chromium } from "@playwright/test";
import { readSyncWorkspace } from "../src/lib/mls/sync-run-repository.mjs";
const root = process.cwd(),
  folder = resolve(root, ".task-logs/sync-ui");
const previousPublicationAt = "2026-10-01T01:00:00.000Z";
const retainedPublication = await readSyncWorkspace({
  actor: { staffId: "10000000-0000-0000-0000-000000000001", roles: ["manager"] },
  now: Date.parse("2026-10-01T03:00:00Z"),
  query: async (sql) => {
    if (sql.includes("FROM mls_ingestion_scopes"))
      return [
        {
          source: "28hse_agent_540",
          receipt_id: "30000000-0000-0000-0000-000000000001",
          scraped_at: previousPublicationAt,
          accepted_at: previousPublicationAt,
        },
      ];
    if (sql.includes("DISTINCT ON"))
      return [
        {
          source: "28hse_agent_540",
          stages: {},
          dispatch_status: "failed",
          finished_at: "2026-10-01T02:00:01Z",
          last_published_at: previousPublicationAt,
        },
      ];
    if (sql.includes("WITH recent AS"))
      return [
        {
          id: "20000000-0000-0000-0000-000000000001",
          source: "28hse_agent_540",
          scope_id: "agent:540",
          operation: "collect",
          workflow_run_id: null,
          git_sha: null,
          request_asset: null,
          request_hash: null,
          receipt_id: null,
          stages: {},
          branches: {},
          counts: {},
          dispatch_status: "failed",
          error_code: null,
          started_at: "2026-10-01T02:00:00Z",
          finished_at: "2026-10-01T02:00:01Z",
        },
      ];
    return [];
  },
});
await mkdir(folder, { recursive: true });
await writeFile(
  resolve(folder, "index.html"),
  '<html lang="zh-HK"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>',
);
await writeFile(
  resolve(folder, "entry.tsx"),
  `
import React from 'react';import {createRoot} from 'react-dom/client';
import {PropertySyncWorkspace} from '../../src/components/admin/property-sync/PropertySyncWorkspace';import {WithdrawalReviewWorkspace} from '../../src/components/admin/property-sync/WithdrawalReviewWorkspace';import '../../src/styles.css';
const scenario=new URLSearchParams(location.search).get('scenario')||'first';
const withdrawalActor='fixture-'+scenario+(new URLSearchParams(location.search).get('actor')||'');
window.fixture={loads:0,requests:0};
const card=(label,source,branch=null)=>({label,source,branch,health:'never_synced',message:'從未成功同步',connected:false,lastCollectionAt:null,lastAcceptedFullAt:null,lastPublishedAt:null,advertisements:null,backlog:null,publicCount:null,stages:{},branchEvidence:null,capability:{enabled:source==='28hse_agent_540',reason:'未接通'}});
const cards=[card('28Hse','28hse_agent_540'),...['EPS','EPT','EPW'].map(b=>card(b,'propertyhk',b))];
const history=Array.from({length:75},(_,i)=>({id:'20000000-0000-0000-0000-'+String(i+1).padStart(12,'0'),source:'28hse_agent_540',scope_id:'agent:540',operation:'collect',workflow_run_id:'123',git_sha:'a'.repeat(40),request_asset:'request-123-1.json',request_hash:'b'.repeat(64),receipt_id:'30000000-0000-0000-0000-000000000001',stages:{collection:{status:'succeeded'},ingestion:{status:'succeeded'},publication:{status:'failed'},verification:{status:'pending'}},branches:{},counts:{canonicalCreated:2,canonicalUpdated:3,published:0,held:1},dispatch_status:'failed',error_code:'MEDIA_FAILED',started_at:'2026-10-01T02:00:00Z',finished_at:null}));
const load=async cursor=>{window.fixture.loads++;await new Promise(r=>setTimeout(r,300));if(scenario==='previous-publication-failed')return ${JSON.stringify(retainedPublication)};if(scenario==='failure')throw Error('synthetic unavailable');const start=cursor?Number(cursor.id):0;const rows=scenario==='history'?history.slice(start,start+25):[];return{cards,history:rows,nextCursor:scenario==='history'&&start+25<75?{id:String(start+25),at:'2026-10-01T02:00:00Z'}:null,asOf:'2026-10-01T02:00:00Z'}};
const request=async input=>{window.fixture.lastKey=input.idempotencyKey;window.fixture.requests++;await new Promise(r=>setTimeout(r,300));if(scenario.startsWith('unknown'))throw Error('synthetic timeout');return{runId:'reserved',status:'accepted'}};
const syncReconcile=async key=>{window.fixture.reconciles=(window.fixture.reconciles||0)+1;window.fixture.readKey=key;return{runId:'reserved',state:scenario==='unknown'?'unknown':'completed',reconciled:scenario!=='unknown'}};
const withdrawalRows=[true,scenario==='withdrawal-partial'].map((allowed,i)=>({candidateId:'40000000-0000-0000-0000-'+String(i+1).padStart(12,'0'),propertyNo:'FIXTURE-'+i,title:i===0?'合成候選甲':'合成候選乙',dealType:'sale',version:'a'.repeat(32),status:'active',decision:{allowed,approval:allowed?'REVIEW_REQUIRED':'NOT_APPROVED',reason:allowed?'confirmed_absence':'active_source_conflict',ruleVersion:'review-withdrawal-v1'},evidence:{kind:'historical_absence',terminalReason:null,otherActiveSources:allowed?[]:['propertyhk']}}));
const withdrawalLoad=async()=>({enabled:true,rows:withdrawalRows,nextCursor:null,ruleVersion:'review-withdrawal-v1'});
const withdrawalPreview=async()=>({previewId:'50000000-0000-0000-0000-000000000001',expiresAt:new Date(Date.now()+900000).toISOString(),rows:withdrawalRows});
const withdrawalResults=()=>withdrawalRows.map((r,i)=>({candidateId:r.candidateId,propertyNo:r.propertyNo,status:i===0?'applied':'blocked',reason:i===1?'STALE_SOURCE_OR_PROPERTY':undefined}));
const withdrawalApply=async input=>{window.fixture.lastKey=input.idempotencyKey;window.fixture.persistedBeforeApply=JSON.parse(sessionStorage.getItem('earnest-property-withdrawal-pending:'+withdrawalActor)||'null')?.key===input.idempotencyKey;window.fixture.requests++;await new Promise(r=>setTimeout(r,300));if(scenario.startsWith('withdrawal-unknown'))throw Error('synthetic unknown commit');if(scenario==='withdrawal-expired')throw Error('STALE_PREVIEW');return{batchId:'batch',results:withdrawalResults()}};
const withdrawalReconcile=async key=>{window.fixture.readKey=key;window.fixture.reconciles=(window.fixture.reconciles||0)+1;await new Promise(r=>setTimeout(r,300));return scenario==='withdrawal-unknown-pending'?{status:'unknown',results:[]}:{status:'confirmed',batchId:'batch',results:withdrawalResults()}};
createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-7xl p-4"><h1 className="text-2xl font-bold mb-4">盤源同步</h1>{scenario.startsWith('withdrawal')?<WithdrawalReviewWorkspace key={withdrawalActor} actorKey={withdrawalActor} roles={[scenario==='withdrawal-denied'?'agent':'manager']} load={withdrawalLoad} preview={withdrawalPreview} apply={withdrawalApply} reconcile={withdrawalReconcile}/>:<PropertySyncWorkspace roles={[scenario==='denied'?'agent':scenario==='manager'?'manager':'admin']} load={load} request={request} reconcile={syncReconcile} actorKey={'fixture-'+scenario}/>}</main>);
`,
);
let server, browser;
let cases = 0;
const diagnostics = [];
const record = (event, url, extra = "") => {
  diagnostics.push({ event, path: new URL(url).pathname, extra, at: Date.now() });
  if (diagnostics.length > 30) diagnostics.shift();
};
try {
  const output = resolve(folder, "dist");
  // Compile the isolated fixture before checking browser navigation and interactions.
  await build({
    root: folder,
    configFile: false,
    envFile: false,
    plugins: [react(), tailwind()],
    resolve: { alias: { "@": resolve(root, "src") } },
    build: { outDir: output, emptyOutDir: false },
  });
  server = await preview({
    root: folder,
    configFile: false,
    envFile: false,
    build: { outDir: output },
    preview: { host: "127.0.0.1", port: 0 },
  });
  const port = server.httpServer.address().port,
    origin = "http://127.0.0.1:" + port;
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      timezoneId: "UTC",
    });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    page.on("request", (r) => record("request", r.url()));
    page.on("requestfinished", (r) => record("finished", r.url()));
    page.on("requestfailed", (r) => record("failed", r.url(), r.failure()?.errorText));
    page.on("pageerror", (e) => record("pageerror", origin, e.message));
    await page.goto(origin + "/?scenario=first");
    await page.getByText("正在讀取同步紀錄…").waitFor();
    await page.getByRole("heading", { name: "EPW", exact: true }).waitFor();
    assert.equal(await page.getByText("從未成功同步", { exact: true }).count(), 4);
    assert.equal(
      await page.getByText("未有同步流程紀錄；完整匯入及上架結果會分開核實。").count(),
      1,
    );
    cases++;
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({
      path: resolve(root, ".task-logs/t9-" + (width === 390 ? "mobile" : "desktop") + ".png"),
      fullPage: true,
    });
    const button = page.getByRole("button", { name: "立即同步", exact: true });
    await button.evaluate((b) => {
      b.click();
      b.click();
    });
    await page.getByText("已提交工作流程，請查看階段進度。").waitFor();
    assert.equal(await page.evaluate(() => window.fixture.requests), 1);
    cases++;
    await page.goto(origin + "/?scenario=previous-publication-failed");
    const failedSource = page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: "28Hse", exact: true }) });
    await failedSource.getByText("同步失敗，保留現有資料", { exact: true }).waitFor();
    const lastPublished = failedSource
      .locator("dt")
      .filter({ hasText: "最後上架" })
      .locator("..")
      .locator("dd");
    const expectedPublicationDate = await page.evaluate(
      (value) => new Date(value).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" }),
      previousPublicationAt,
    );
    assert.equal(await lastPublished.textContent(), expectedPublicationDate);
    assert.equal(
      await page.getByText("同步失敗，保留現有資料", { exact: true }).count(),
      2,
      "card and durable history expose the rejected dispatch",
    );
    assert.equal(
      await page
        .getByText("工作流程未被接收；請管理員核對接駁設定後再提交同步。", { exact: true })
        .count(),
      1,
      "rejected collection has no frozen request to replay",
    );
    await page.getByRole("button", { name: "重新載入", exact: true }).first().click();
    await page.waitForFunction(() => window.fixture.loads === 2);
    await page.waitForFunction(
      () =>
        !Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "重新載入")
          .disabled,
    );
    assert.equal(await lastPublished.textContent(), expectedPublicationDate);
    assert.equal(await page.evaluate(() => window.fixture.requests), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({
      path: resolve(root, ".task-logs/t9-last-publication-" + width + ".png"),
      fullPage: true,
    });
    cases++;
    await page.goto(origin + "/?scenario=unknown");
    await page.getByRole("heading", { name: "28Hse", exact: true }).waitFor();
    await page.getByRole("button", { name: "立即同步", exact: true }).click();
    await page.getByText("結果待核實，請勿重複提交", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "立即同步", exact: true }).isDisabled(),
      true,
    );
    cases++;
    await page.getByRole("button", { name: "核對工作流程結果", exact: true }).click();
    assert.equal(
      await page.getByRole("button", { name: "立即同步", exact: true }).isDisabled(),
      true,
    );
    assert.equal(await page.evaluate(() => window.fixture.requests), 1);
    assert.equal(
      await page.evaluate(() => window.fixture.lastKey === window.fixture.readKey),
      true,
    );
    cases++;
    await page.goto(origin + "/?scenario=unknown-completed");
    await page.getByRole("heading", { name: "28Hse", exact: true }).waitFor();
    await page.getByRole("button", { name: "立即同步", exact: true }).click();
    await page.getByText("結果待核實，請勿重複提交", { exact: true }).waitFor();
    const pendingKey = await page.evaluate(() => window.fixture.lastKey);
    await page.reload();
    await page.getByRole("button", { name: "核對工作流程結果", exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "立即同步", exact: true }).isDisabled(),
      true,
    );
    await page.getByRole("button", { name: "核對工作流程結果", exact: true }).evaluate((b) => {
      b.click();
      b.click();
    });
    await page.getByText("已核對工作流程結果，請查看各階段紀錄。", { exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        !Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "立即同步")
          .disabled,
    );
    assert.equal(
      await page.evaluate(() => window.fixture.requests),
      0,
      "readback after reload must not resend",
    );
    assert.equal(await page.evaluate(() => window.fixture.reconciles), 1);
    assert.equal(await page.evaluate(() => window.fixture.readKey), pendingKey);
    assert.equal(
      await page.evaluate(() =>
        sessionStorage.getItem("earnest-property-sync-pending:fixture-unknown-completed"),
      ),
      null,
      "confirmed readback clears the tab pending identity",
    );
    cases++;
    await page.goto(origin + "/?scenario=failure");
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByRole("heading", { name: "28Hse", exact: true }).count(), 0);
    cases++;
    await page.goto(origin + "/?scenario=denied");
    await page.getByRole("alert").waitFor();
    assert.equal(await page.evaluate(() => window.fixture.loads), 0);
    cases++;
    await page.goto(origin + "/?scenario=manager");
    await page.getByRole("heading", { name: "28Hse", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "立即同步", exact: true }).count(), 0);
    cases++;
    await page.goto(origin + "/?scenario=history");
    await page.getByRole("button", { name: "載入較早紀錄" }).waitFor();
    assert.equal(await page.getByText("支援診斷", { exact: true }).count(), 25);
    await page.getByRole("button", { name: "載入較早紀錄" }).click();
    await page.waitForFunction(() => document.querySelectorAll("summary").length === 51);
    assert.equal(await page.getByText("支援診斷", { exact: true }).count(), 50);
    cases++;
    for (const scenario of [
      "withdrawal",
      "withdrawal-partial",
      "withdrawal-unknown",
      "withdrawal-expired",
    ]) {
      await page.goto(origin + "/?scenario=" + scenario);
      await page.getByRole("checkbox", { name: "選取 合成候選甲" }).waitFor();
      if (scenario === "withdrawal") {
        assert.equal(
          await page.getByText("未獲批准，暫不下架", { exact: true }).count(),
          1,
          "ordinary candidate status uses Hong Kong Traditional Chinese",
        );
        assert.equal(await page.getByText("待逐盤核實", { exact: true }).count(), 1);
        assert.equal(
          await page.getByText("核實狀態：NOT_APPROVED", { exact: true }).isVisible(),
          false,
          "raw approval is hidden in support diagnostics",
        );
        await page
          .locator("li")
          .filter({ has: page.getByRole("checkbox", { name: "選取 合成候選乙" }) })
          .getByText("來源及版本", { exact: true })
          .click();
        assert.equal(
          await page.getByText("核實狀態：NOT_APPROVED", { exact: true }).isVisible(),
          true,
        );
      }
      await page.getByRole("checkbox", { name: "選取 合成候選甲" }).check();
      await page.getByRole("button", { name: "預覽所選撤盤" }).click();
      await page.getByRole("heading", { name: "確認撤盤預覽" }).waitFor();
      if (scenario === "withdrawal") {
        assert.equal(
          await page.getByRole("checkbox", { name: "套用 合成候選乙" }).isDisabled(),
          true,
        );
        assert.equal(await page.getByRole("button", { name: "確認所選撤盤" }).isDisabled(), true);
        await page.getByRole("button", { name: "取消預覽" }).click();
        assert.equal(await page.evaluate(() => window.fixture.requests), 0);
        cases++;
        await page.getByRole("button", { name: "預覽所選撤盤" }).click();
      }
      await page.getByRole("textbox", { name: "核實原因" }).fill("已逐盤核實實際來源狀態");
      await page.getByRole("checkbox", { name: "我已逐盤核實，只套用已選項目。" }).check();
      await page.getByRole("button", { name: "確認所選撤盤" }).evaluate((b) => {
        b.click();
        b.click();
      });
      if (scenario === "withdrawal-unknown") {
        await page.getByRole("button", { name: "核對提交結果" }).waitFor();
        assert.equal(await page.getByRole("button", { name: "確認所選撤盤" }).isDisabled(), true);
        const originalKey = await page.evaluate(() => window.fixture.lastKey);
        await page.reload();
        await page.getByRole("checkbox", { name: "選取 合成候選甲" }).waitFor();
        assert.equal(
          await page.getByRole("button", { name: "核對提交結果" }).count(),
          1,
          "reload preserves the unresolved withdrawal and its read-only reconciliation",
        );
        assert.equal(
          await page.getByRole("checkbox", { name: "選取 合成候選甲" }).isDisabled(),
          true,
        );
        assert.equal(await page.getByRole("button", { name: "預覽所選撤盤" }).isDisabled(), true);
        assert.equal(
          await page.evaluate(() => window.fixture.requests),
          0,
          "reload never reapplies",
        );
        await page.getByRole("button", { name: "核對提交結果" }).evaluate((b) => {
          b.click();
          b.click();
        });
        await page.getByRole("heading", { name: "撤盤結果" }).waitFor();
        assert.equal(await page.evaluate(() => window.fixture.reconciles), 1);
        assert.equal(await page.evaluate(() => window.fixture.readKey), originalKey);
        assert.equal(
          await page.evaluate(() =>
            sessionStorage.getItem(
              "earnest-property-withdrawal-pending:fixture-withdrawal-unknown",
            ),
          ),
          null,
          "only confirmed readback clears this actor's pending key",
        );
        assert.equal(
          await page.getByRole("checkbox", { name: "選取 合成候選甲" }).isDisabled(),
          false,
        );
        cases++;
      } else if (scenario === "withdrawal-expired") {
        await page.getByText("預覽已過期，請重新預覽。", { exact: true }).waitFor();
        assert.equal(await page.getByRole("heading", { name: "確認撤盤預覽" }).count(), 0);
      } else {
        await page.getByRole("heading", { name: "撤盤結果" }).waitFor();
        await page.getByText("FIXTURE-0：已核實下架", { exact: true }).waitFor();
      }
      assert.equal(
        await page.evaluate(() => window.fixture.requests),
        scenario === "withdrawal-unknown" ? 0 : 1,
      );
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      cases++;
    }
    await page.goto(origin + "/?scenario=withdrawal-unknown-pending");
    await page.getByRole("checkbox", { name: "選取 合成候選甲" }).waitFor();
    await page.getByRole("combobox", { name: "撤盤來源" }).selectOption("propertyhk");
    await page.getByRole("checkbox", { name: "選取 合成候選甲" }).check();
    await page.getByRole("button", { name: "預覽所選撤盤" }).click();
    await page.getByRole("textbox", { name: "核實原因" }).fill("合成資料驗證待核實恢復");
    await page.getByRole("checkbox", { name: "我已逐盤核實，只套用已選項目。" }).check();
    await page.getByRole("button", { name: "確認所選撤盤" }).click();
    await page.getByRole("button", { name: "核對提交結果" }).waitFor();
    await page.waitForFunction(
      () =>
        !Array.from(document.querySelectorAll("button")).find(
          (b) => b.textContent === "核對提交結果",
        ).disabled,
    );
    assert.equal(
      await page.evaluate(() => window.fixture.persistedBeforeApply),
      true,
      "key saved before apply starts",
    );
    const withdrawalPendingKey = await page.evaluate(() => window.fixture.lastKey);
    await page.reload();
    await page.getByRole("button", { name: "核對提交結果" }).waitFor();
    assert.equal(await page.getByRole("combobox", { name: "撤盤來源" }).inputValue(), "propertyhk");
    assert.equal(await page.getByRole("combobox", { name: "撤盤來源" }).isDisabled(), true);
    await page.getByRole("button", { name: "核對提交結果" }).evaluate((b) => {
      b.click();
      b.click();
    });
    await page.waitForFunction(
      () =>
        window.fixture.reconciles === 1 &&
        !Array.from(document.querySelectorAll("button")).find(
          (b) => b.textContent === "核對提交結果",
        ).disabled,
    );
    assert.equal(await page.evaluate(() => window.fixture.readKey), withdrawalPendingKey);
    assert.equal(await page.evaluate(() => window.fixture.requests), 0);
    assert.equal(await page.getByRole("checkbox", { name: "選取 合成候選甲" }).isDisabled(), true);
    assert.equal(await page.getByRole("heading", { name: "撤盤結果" }).count(), 0);
    assert.deepEqual(
      await page.evaluate(() =>
        JSON.parse(
          sessionStorage.getItem(
            "earnest-property-withdrawal-pending:fixture-withdrawal-unknown-pending",
          ),
        ),
      ),
      { key: withdrawalPendingKey, source: "propertyhk" },
    );
    await page.screenshot({
      path: resolve(root, ".task-logs/t10-pending-reload-" + width + ".png"),
      fullPage: true,
    });
    cases++;
    await page.goto(origin + "/?scenario=withdrawal-unknown-pending&actor=-other");
    await page.getByRole("checkbox", { name: "選取 合成候選甲" }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "核對提交結果" }).count(),
      0,
      "another actor cannot inherit the first actor's key",
    );
    assert.equal(await page.evaluate(() => window.fixture.requests), 0);
    assert.equal(await page.evaluate(() => window.fixture.reconciles || 0), 0);
    await page.goto(origin + "/?scenario=withdrawal-unknown-pending");
    await page.getByRole("button", { name: "核對提交結果" }).waitFor();
    assert.equal(await page.getByRole("checkbox", { name: "選取 合成候選甲" }).isDisabled(), true);
    cases++;
    await page.addInitScript(() => {
      const scenario = new URLSearchParams(location.search).get("scenario");
      if (["withdrawal-storage-unavailable", "sync-storage-unavailable"].includes(scenario)) {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (
            key.startsWith("earnest-property-withdrawal-pending:") ||
            key.startsWith("earnest-property-sync-pending:")
          )
            throw new DOMException("synthetic disabled storage", "SecurityError");
          return original.call(this, key, value);
        };
      } else if (scenario === "sync-invalid-pending") {
        sessionStorage.setItem(
          "earnest-property-sync-pending:fixture-sync-invalid-pending",
          "invalid synthetic key",
        );
      } else if (scenario === "withdrawal-invalid-pending") {
        sessionStorage.setItem(
          "earnest-property-withdrawal-pending:fixture-withdrawal-invalid-pending",
          "{invalid synthetic record}",
        );
      }
    });
    await page.goto(origin + "/?scenario=withdrawal-storage-unavailable");
    await page.getByRole("checkbox", { name: "選取 合成候選甲" }).check();
    await page.getByRole("button", { name: "預覽所選撤盤" }).click();
    await page.getByRole("textbox", { name: "核實原因" }).fill("合成資料驗證儲存失敗");
    await page.getByRole("checkbox", { name: "我已逐盤核實，只套用已選項目。" }).check();
    await page.getByRole("button", { name: "確認所選撤盤" }).click();
    await page
      .getByText("未能保存或讀取本頁提交紀錄，請管理員查核後再操作。", { exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.fixture.requests),
      0,
      "no mutation when key persistence fails",
    );
    assert.equal(await page.getByRole("button", { name: "確認所選撤盤" }).isDisabled(), true);
    cases++;
    await page.goto(origin + "/?scenario=withdrawal-invalid-pending");
    await page
      .getByText("未能保存或讀取本頁提交紀錄，請管理員查核後再操作。", { exact: true })
      .waitFor();
    await page.getByRole("checkbox", { name: "選取 合成候選甲" }).waitFor();
    assert.equal(await page.getByRole("checkbox", { name: "選取 合成候選甲" }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "預覽所選撤盤" }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.fixture.requests), 0);
    cases++;
    await page.goto(origin + "/?scenario=withdrawal-denied");
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByRole("button", { name: "預覽所選撤盤" }).count(), 0);
    cases++;
    await page.goto(origin + "/?scenario=sync-storage-unavailable");
    await page.getByRole("heading", { name: "28Hse", exact: true }).waitFor();
    await page.getByRole("button", { name: "立即同步", exact: true }).click();
    await page.waitForFunction(
      () => window.fixture.requests > 0 || document.querySelector('[role="alert"]'),
    );
    assert.equal(
      await page.evaluate(() => window.fixture.requests),
      0,
      "no workflow dispatch when pending-key persistence fails",
    );
    await page
      .getByText("未能保存或讀取本頁提交紀錄，請管理員查核後再操作。", { exact: true })
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: "立即同步", exact: true }).isDisabled(),
      true,
    );
    cases++;
    await page.goto(origin + "/?scenario=sync-invalid-pending");
    await page.getByRole("heading", { name: "28Hse", exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "立即同步", exact: true }).isDisabled(),
      true,
      "invalid prior key cannot authorize a new operation",
    );
    assert.equal(await page.evaluate(() => window.fixture.requests), 0);
    await page
      .getByText("未能保存或讀取本頁提交紀錄，請管理員查核後再操作。", { exact: true })
      .waitFor();
    cases++;
    await context.close();
  }
  console.log(
    JSON.stringify({
      status: "PASS",
      synthetic: true,
      fixtureMode: "built",
      freshBuild: true,
      cases,
      viewports: [1440, 390],
      providerRequests: 0,
      databaseWrites: 0,
    }),
  );
} catch (error) {
  console.error(JSON.stringify({ syntheticUiDiagnostics: diagnostics }));
  throw error;
} finally {
  await browser?.close();
  await server?.close();
}
