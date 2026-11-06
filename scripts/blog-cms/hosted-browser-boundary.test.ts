import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { chromium } from "@playwright/test";
import { installReadBoundary, BrowserBoundaryError } from "./hosted-browser-boundary";

for (const resource of ["document", "script", "image", "fetch", "same-origin-chain"] as const) {
  test(
    `LOCAL_BROWSER: ${resource} redirect stops before any next hop or credential propagation`,
    { timeout: 30000 },
    async () => {
      let unapprovedHits = 0,
        secondHopHits = 0;
      const received: Record<string, string | string[] | undefined>[] = [];
      const blocked = createServer((req, res) => {
        unapprovedHits++;
        received.push(req.headers);
        res.end("MUST_NOT_BE_REACHED");
      });
      blocked.listen(0, "127.0.0.1");
      await once(blocked, "listening");
      const blockedOrigin = `http://127.0.0.1:${(blocked.address() as { port: number }).port}`;
      const firstHeaders: Record<string, string | string[] | undefined>[] = [];
      const app = createServer((req, res) => {
        if (req.url === "/redirect") {
          firstHeaders.push(req.headers);
          res.writeHead(302, {
            location: resource === "same-origin-chain" ? "/hop" : blockedOrigin + "/stolen",
          });
          res.end();
          return;
        }
        if (req.url === "/hop") {
          secondHopHits++;
          res.writeHead(307, { location: blockedOrigin + "/stolen" });
          res.end();
          return;
        }
        res.setHeader("content-type", "text/html");
        res.end("<!doctype html><title>Local boundary test</title>");
      });
      app.listen(0, "127.0.0.1");
      await once(app, "listening");
      const appOrigin = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
      let browser;
      try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
          serviceWorkers: "block",
          extraHTTPHeaders: { authorization: "Bearer local-session" },
        });
        await context.addCookies([
          { name: "local-session-cookie", value: "local-secret", url: appOrigin },
        ]);
        const errors: unknown[] = [];
        await installReadBoundary(
          context,
          {
            appOrigin,
            authOrigin: "https://auth.invalid",
            blobOrigin: "https://blob.invalid",
            session: "local-session",
            bypass: "local-bypass",
          },
          () => {},
          (e) => errors.push(e),
        );
        const page = await context.newPage();
        if (resource === "document" || resource === "same-origin-chain")
          await page.goto(appOrigin + "/redirect").catch(() => null);
        else {
          await page.goto(appOrigin);
          await page.evaluate(async (kind) => {
            if (kind === "fetch") {
              await fetch("/redirect").catch(() => null);
              return;
            }
            await new Promise<void>((resolve) => {
              const element =
                kind === "script"
                  ? document.createElement("script")
                  : document.createElement("img");
              element.onload = () => resolve();
              element.onerror = () => resolve();
              element.src = "/redirect";
              document.body.append(element);
            });
          }, resource);
        }
        assert.equal(errors.length, 1);
        assert.ok(errors[0] instanceof BrowserBoundaryError);
        assert.equal(
          (errors[0] as BrowserBoundaryError).code,
          resource === "same-origin-chain"
            ? "BROWSER_REDIRECT_REFUSED"
            : "BROWSER_REDIRECT_ORIGIN_REFUSED",
        );
        assert.equal(firstHeaders.length, 1);
        assert.equal(firstHeaders[0].authorization, "Bearer local-session");
        assert.equal(firstHeaders[0]["x-vercel-protection-bypass"], "local-bypass");
        assert.ok(String(firstHeaders[0].cookie).includes("local-secret"));
        assert.equal(secondHopHits, 0);
        assert.equal(unapprovedHits, 0);
        assert.deepEqual(received, []);
        errors.length = 0;
        await page.goto(blockedOrigin + "/direct").catch(() => null);
        assert.equal((errors[0] as BrowserBoundaryError).code, "BROWSER_ORIGIN_REFUSED");
        assert.equal(unapprovedHits, 0);
      } finally {
        await browser?.close();
        await Promise.all([
          new Promise<void>((r) => app.close(() => r())),
          new Promise<void>((r) => blocked.close(() => r())),
        ]);
      }
    },
  );
}
