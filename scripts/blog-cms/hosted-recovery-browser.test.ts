import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { fixture } from "./hosted-test-fixture";
import { runHostedRecovery } from "./hosted-browser";
import { checkCache } from "./hosted-runtime";

test(
  "LOCAL_BROWSER: actual unavailable responses and Retry clicks recover both pages",
  { timeout: 30000 },
  async () => {
    const p = fixture();
    let offline = false,
      restores = 0;
    const statuses: number[] = [];
    const expected = [
      { path: "/blog", title: "Restored main" },
      { path: "/blog/" + p.articles[0].slug, title: "Restored article" },
    ];
    const server = createServer((req, res) => {
      res.setHeader("cache-control", "no-store");
      if (req.url?.startsWith("/_serverFn/")) {
        const status = offline ? 503 : 200;
        statuses.push(status);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            title: req.url.includes(p.functions.pageServer) ? expected[0].title : expected[1].title,
          }),
        );
        return;
      }
      const entry = expected.find((v) => v.path === req.url)!;
      const id = req.url === "/blog" ? p.functions.pageServer : p.functions.articleServer;
      res.writeHead(offline ? 500 : 200, { "content-type": "text/html" });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>Local recovery test</title><h1>${offline ? "文章暫時未能載入" : entry?.title}</h1><button id="retry">重試</button><script>document.getElementById('retry').onclick=async()=>{const r=await fetch('/_serverFn/${id}');const data=await r.json();document.querySelector('h1').textContent=data.title;};</script>`,
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    p.target.origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const result = await runHostedRecovery(
        p,
        {},
        expected,
        () => {},
        {
          enable: async () => {
            offline = true;
          },
          restore: async () => {
            offline = false;
            restores++;
          },
        },
        async (name) =>
          (await fetch(p.target.origin + "/_serverFn/" + p.functions[name], { redirect: "error" }))
            .status,
        checkCache,
      );
      assert.equal(restores, 1);
      assert.deepEqual(
        result.pages.map((v) => v.recoveredTitle),
        expected.map((v) => v.title),
      );
      assert.deepEqual(statuses, [503, 503, 200, 200]);
      assert.equal(result.restored, true);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  },
);
