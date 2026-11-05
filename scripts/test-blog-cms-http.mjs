import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { runWithStartContext } from "@tanstack/start-storage-context";
import { withOwnedPostgres } from "./acceptance/owned-postgres-test.mjs";
import { verifyBuildReceipt } from "./blog-cms/acceptance-identity.mjs";
assert.ok(
  process.argv
    .slice(2)
    .every(
      (arg) =>
        arg === "--cutover-rehearsal" || arg === "--final-fix" || arg === "--final-fix-marker",
    ),
  "Unknown HTTP acceptance option",
);
const rehearseCutover = process.argv.includes("--cutover-rehearsal");
const finalFix =
  process.argv.includes("--final-fix") || process.argv.includes("--final-fix-marker");
const buildBinding = verifyBuildReceipt(); // Fail before Docker, output lookup or server startup.
console.log("BUILD_BINDING " + JSON.stringify(buildBinding));
const { cutoverRehearsal } = await import("./blog-cms/cutover-rehearsal.mjs");
const { refuseExternalTargets, seedSessions, runAcceptance } =
  await import("./blog-cms/acceptance-scenario.mjs");
const { unwrapServerFnResponse } = await import("../src/lib/neon/server-fn-response.ts");
const { serverFnFetcher } = await import(
  new URL("./serverFnFetcher.js", import.meta.resolve("@tanstack/start-client-core/client-rpc"))
    .href
);
refuseExternalTargets();
const output =
  ".superpowers/sdd/2026-11-05-blog-cms-implementation/test-logs/" +
  (process.argv.includes("--final-fix-marker")
    ? "final-fix-marker-http-artifacts"
    : finalFix
      ? "final-fix-http-artifacts"
      : rehearseCutover
        ? "task-9-http-artifacts"
        : "task-8-r1-http-artifacts");
mkdirSync(output, { recursive: true });
const ssr = ".output/server/_ssr/";
function idsFor(prefix) {
  const file = readdirSync(ssr).find((f) => f.startsWith(prefix + "-") && f.endsWith(".mjs"));
  assert.ok(file, "Run npm run build before HTTP acceptance");
  const text = readFileSync(ssr + file, "utf8");
  return Object.fromEntries(
    [...text.matchAll(/id: "([a-f0-9]+)",\s*name: "([^"]+)"/g)].map((m) => [m[2], m[1]]),
  );
}
const adminIds = idsFor("blog-admin"),
  publicIds = idsFor("blog-public");
const legacyIds = finalFix ? idsFor("admin-cms") : {};
const listen = async (server) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
};
await withOwnedPostgres(async (owned) => {
  await seedSessions(owned.query);
  const bridge = createServer(async (req, res) => {
    let client;
    try {
      assert.equal(req.method, "POST");
      assert.equal(
        req.headers["neon-connection-string"],
        "postgresql://postgres@owned.invalid/postgres",
      );
      const parts = [];
      for await (const part of req) parts.push(part);
      const body = JSON.parse(Buffer.concat(parts).toString());
      client = await owned.pool.connect();
      const batch = Array.isArray(body.queries);
      if (batch) {
        await client.query("BEGIN");
        const levels = {
          ReadCommitted: "READ COMMITTED",
          RepeatableRead: "REPEATABLE READ",
          Serializable: "SERIALIZABLE",
          ReadUncommitted: "READ UNCOMMITTED",
        };
        const level = req.headers["neon-batch-isolation-level"];
        if (level) {
          assert.ok(levels[level]);
          await client.query("SET TRANSACTION ISOLATION LEVEL " + levels[level]);
        }
        if (req.headers["neon-batch-read-only"] === "true")
          await client.query("SET TRANSACTION READ ONLY");
      }
      const results = [];
      for (const q of batch ? body.queries : [body]) {
        const r = await client.query({
          text: q.query,
          values: q.params,
          rowMode: "array",
          types: { getTypeParser: () => (value) => value },
        });
        results.push({
          command: r.command,
          rowCount: r.rowCount,
          fields: r.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
          rows: r.rows,
        });
      }
      if (batch) await client.query("COMMIT");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(batch ? { results } : results[0]));
    } catch (error) {
      await client?.query("ROLLBACK");
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: error.message, code: error.code }));
    } finally {
      client?.release();
    }
  });
  const bridgePort = await listen(bridge);
  const probe = createServer();
  const appPort = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  const origin = "http://127.0.0.1:" + appPort;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|HOME|USERPROFILE)$/i.test(key),
    ),
  );
  const child = spawn(
    process.execPath,
    ["--import", "./scripts/blog-cms/owned-http-preload.mjs", ".output/server/index.mjs"],
    {
      env: {
        ...env,
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: String(appPort),
        DATABASE_URL: "postgresql://postgres@owned.invalid/postgres",
        NEON_AUTH_BASE_URL: origin + "/owned-auth-fixture",
        BLOG_ACCEPTANCE_BRIDGE: "http://127.0.0.1:" + bridgePort,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let stdout = "",
    stderr = "",
    browser;
  child.stdout.on("data", (b) => {
    stdout += b;
  });
  child.stderr.on("data", (b) => {
    stderr += b;
  });
  const statusCounts = {};
  function call(id, method, data, role, isPrivate = true) {
    assert.ok(id, "Built function ID must exist");
    return unwrapServerFnResponse(
      runWithStartContext({ startOptions: {} }, () =>
        serverFnFetcher(
          origin + "/_serverFn/" + id,
          [
            {
              method,
              data,
              headers: {
                origin,
                "sec-fetch-site": "same-origin",
                ...(role ? { authorization: "Bearer task8-" + role } : {}),
              },
            },
          ],
          async (url, init) => {
            assert.equal(new URL(url).origin, origin);
            const response = await fetch(url, init);
            statusCounts[response.status] = (statusCounts[response.status] ?? 0) + 1;
            assert.match(response.headers.get("cache-control") ?? "", /no-store/);
            if (isPrivate) {
              assert.match(response.headers.get("cache-control"), /private/);
              assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
            }
            if (response.status >= 400) {
              const message = await response.clone().text();
              assert.doesNotMatch(
                message,
                /SELECT |postgres|owned\.invalid|task8 injected|stack|neon_auth/,
              );
              assert.equal(response.headers.get("x-tss-raw"), "true");
            }
            return response;
          },
        ),
      ),
    ).then((result) => {
      if (result.error) throw result.error;
      return result.result;
    });
  }
  const api = {
    list: (data, role = "admin") => call(adminIds.listServer, "GET", data, role),
    preview: (data, role = "admin") => call(adminIds.previewServer, "GET", data, role),
    save: (data, role = "admin") => call(adminIds.saveServer, "POST", data, role),
    state: () => call(adminIds.stateServer, "GET", {}, "admin"),
    settings: (data) => call(adminIds.settingsServer, "POST", data, "admin"),
    category: (data) => call(adminIds.categoryServer, "POST", data, "admin"),
  };
  const publicApi = {
    page: (data) => call(publicIds.pageServer, "GET", data, undefined, false),
    article: (slug) => call(publicIds.articleServer, "GET", { slug }, undefined, false),
  };
  async function document(path, status, text) {
    const response = await fetch(origin + path, { redirect: "manual" });
    assert.equal(response.status, status, path);
    for (const name of ["cache-control", "cdn-cache-control", "vercel-cdn-cache-control"])
      assert.equal(response.headers.get(name), "no-store", path + " " + name);
    const html = await response.text();
    assert.ok(html.includes(text), path + " rendered " + text);
    assert.ok(!html.includes("私人草稿不可外洩"));
    return html;
  }
  try {
    const deadline = Date.now() + 30000;
    for (;;) {
      try {
        if ((await fetch(origin + "/favicon.svg")).ok) break;
      } catch {
        /* bounded readiness */
      }
      assert.equal(child.exitCode, null, stderr);
      assert.ok(Date.now() < deadline, "built server readiness timeout");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    console.log(
      "PASS real built Nitro HTTP server ready on loopback; unchanged auth with owned SQL transport",
    );
    const rejected = (status) => (e) => e.name === "ServerFnResponseError" && e.status === status;
    await assert.rejects(call(adminIds.stateServer, "GET", {}, undefined), rejected(401));
    await assert.rejects(call(adminIds.stateServer, "GET", {}, "viewer"), rejected(403));
    await assert.rejects(
      call(adminIds.previewServer, "GET", { id: "00000000-0000-4000-8000-000000000001" }, "admin"),
      rejected(404),
    );
    await assert.rejects(call(adminIds.saveServer, "POST", {}, "admin"), rejected(422));
    await runAcceptance({
      owned,
      api,
      publicApi,
      cutover: rehearseCutover ? cutoverRehearsal({ owned, api, publicApi, document }) : undefined,
      checkPublic: async ({ stage, records }) => {
        if (stage === "imported") {
          for (const record of records) {
            const visible = record.published && !record.publishedAt;
            await document(
              "/blog/" + record.slug,
              visible ? 200 : 404,
              visible ? record.title : "找不到文章或分類",
            );
          }
          console.log(
            "PASS all 101 original /blog/slug HTTP URLs: 99 public 200, one draft 404, one future 404, no redirects or stored responses",
          );
          await document("/blog", 200, "已編輯");
          await document("/blog?category=" + encodeURIComponent("成交分析"), 200, "分類標題");
          await document("/blog/acceptance-002", 200, "原文 &lt;不是HTML&gt; 1");
          await document("/blog/acceptance-100", 404, "找不到文章或分類");
          await document("/blog/acceptance-101", 404, "找不到文章或分類");
          await document("/blog/missing", 404, "找不到文章或分類");
          await document("/blog?category=missing", 404, "找不到文章或分類");
        } else {
          await document("/blog/acceptance-002", 200, "成交新名稱");
          await document("/blog/acceptance-001", 404, "找不到文章或分類");
          await document("/blog?category=" + encodeURIComponent("成交分析"), 200, "分類獨立編輯");
          const sitemap = await document("/sitemap.xml", 200, "/blog/editorial-standards");
          assert.ok(!sitemap.includes("/blog/acceptance-001<"));
          assert.ok(!sitemap.includes("/blog/acceptance-100<"));
          const llms = await document("/llms.txt", 200, "市場分析 Blog");
          assert.ok(!llms.includes("/blog/sham-tseng-buying-guide-2026"));
        }
      },
    });
    console.log(
      "PASS HTTP serialization and 200/401/403/404/409/422/503 private status/header boundaries",
      JSON.stringify(statusCounts),
    );
    if (finalFix) {
      const { finalFixHttp } = await import("./blog-cms/final-fix-http.mjs");
      await finalFixHttp({
        api,
        publicApi,
        document,
        query: owned.query,
        restore: (data) => call(legacyIds.restoreAdminCmsRevisionServer, "POST", data, "admin"),
        archive: (data) => call(legacyIds.archiveAdminCmsResourceServer, "POST", data, "admin"),
      });
    }
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    for (const path of ["/blog", "/blog/acceptance-002"]) {
      await owned.query("ALTER TABLE articles RENAME TO task8_articles_offline");
      try {
        // Router uses HTTP 500 for thrown loader errors; exact status is asserted, not labelled 503.
        await document(path, 500, "文章暫時未能載入");
        const response = await page.goto(origin + path);
        assert.equal(response.status(), 500);
        await page.getByRole("heading", { name: "文章暫時未能載入" }).waitFor();
        await page.getByRole("button", { name: "重試", exact: true }).waitFor();
      } finally {
        await owned.query("ALTER TABLE task8_articles_offline RENAME TO articles");
      }
      await page.getByRole("button", { name: "重試", exact: true }).click();
      await page
        .getByRole("heading", {
          name: path === "/blog" ? "主頁已編輯" : "驗收文章 2 已編輯",
          exact: true,
        })
        .waitFor();
      await page.screenshot({
        path:
          output + (path === "/blog" ? "/task-8-public-retry.png" : "/task-8-article-retry.png"),
        fullPage: true,
      });
      console.log("PASS built browser retry refetch after real DB outage " + path);
    }
    await owned.query("ALTER TABLE articles RENAME TO task8_articles_offline");
    try {
      // Direct public endpoints, distinct from SSR loader and admin failure assertions.
      for (const run of [
        () => publicApi.page({ page: 1 }),
        () => publicApi.article("acceptance-002"),
      ])
        await assert.rejects(
          run(),
          (error) =>
            error.name === "ServerFnResponseError" &&
            error.status === 503 &&
            error.message === "BLOG_UNAVAILABLE",
        );
      console.log(
        "PASS direct built public page/article server-function HTTP 503, safe BLOG_UNAVAILABLE, raw response and no-store",
      );
      for (const path of ["/sitemap.xml", "/llms.txt"])
        await document(path, 503, "BLOG_UNAVAILABLE");
    } finally {
      await owned.query("ALTER TABLE task8_articles_offline RENAME TO articles");
    }
    await context.close();
    console.log(
      "PASS built public HTTP success/error/not-found no-store and actual browser retry; hosted/provider acceptance NOT_RUN",
    );
    const expectedWarning =
      "[site.ts] VITE_CONTACT_WHATSAPP_PHONE is not set -- every WhatsApp CTA will fall back to /contact instead of opening WhatsApp. See .env.example.";
    assert.equal(
      stderr.trim(),
      expectedWarning,
      "Only the known no-secrets local configuration warning is expected",
    );
    console.log(
      "EXPECTED_WARNING unconfigured WhatsApp contact; no unexpected built-server stderr",
    );
    assert.deepEqual(
      verifyBuildReceipt(),
      buildBinding,
      "Source/output/receipt must stay bound for the entire HTTP run",
    );
    console.log("BUILD_BINDING_VERIFIED " + JSON.stringify(buildBinding));
  } finally {
    await browser?.close();
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
    await new Promise((resolve) => bridge.close(resolve));
    writeFileSync(output + "/task-8-http-server.stdout.log", stdout);
    writeFileSync(output + "/task-8-http-server.stderr.log", stderr);
  }
});
