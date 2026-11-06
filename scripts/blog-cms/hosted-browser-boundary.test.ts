import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { scanHostedPage } from "./hosted-browser";
import { VIEWPORTS } from "../../e2e/a11y-checks";
import { chromium } from "@playwright/test";
import { installReadBoundary, BrowserBoundaryError } from "./hosted-browser-boundary";

for (const resource of [
  "document",
  "script",
  "image",
  "iframe",
  "fetch",
  "same-origin-chain",
] as const) {
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
            excludeThirdPartyIframes: true,
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
                  : kind === "iframe"
                    ? document.createElement("iframe")
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

test(
  "LOCAL_BROWSER: excluded iframe stays offline while parent scanner passes and reports axe issues",
  { timeout: 30000 },
  async () => {
    let excludedHits = 0;
    const sink = createServer((_req, res) => {
      excludedHits++;
      res.end("must not load");
    });
    sink.listen(0, "127.0.0.1");
    await once(sink, "listening");
    const frameOrigin = `http://127.0.0.1:${(sink.address() as { port: number }).port}`;
    const app = createServer((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(
        `<!doctype html><html lang="en"><head><title>Contact</title></head><body><main><h1>Contact</h1><button>Call us</button><iframe title="Branch map" src="${frameOrigin}/map"></iframe></main></body></html>`,
      );
    });
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    const appOrigin = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ serviceWorkers: "block" });
      const errors: unknown[] = [],
        exclusions: unknown[] = [],
        evidence: unknown[] = [];
      await installReadBoundary(
        context,
        {
          appOrigin,
          authOrigin: "https://auth.invalid",
          blobOrigin: "https://blob.invalid",
          bypass: "local-bypass",
          excludeThirdPartyIframes: true,
        },
        () => {},
        (e) => errors.push(e),
        (e) => exclusions.push(e),
      );
      const page = await context.newPage();
      assert.equal((await page.goto(appOrigin + "/contact"))?.status(), 200);
      await page.waitForLoadState("networkidle");
      const options = {
        appOrigin,
        label: "contact parent",
        viewport: VIEWPORTS[1],
        guard: () => {},
        boundaryFailed: () => errors.length > 0,
        evidence: (row: unknown) => evidence.push(row),
      };
      await scanHostedPage(page, options);
      assert.equal(excludedHits, 0);
      assert.equal(exclusions.length, 1);
      assert.equal(errors.length, 0);
      assert.equal(evidence.length, 1);
      await page.evaluate(() => {
        const bad = document.createElement("button");
        bad.id = "unnamed";
        document.querySelector("main")!.append(bad);
      });
      await assert.rejects(
        scanHostedPage(page, options),
        (error: unknown) =>
          error instanceof assert.AssertionError &&
          Array.isArray(error.actual) &&
          error.actual.some((v: { id: string }) => v.id === "button-name"),
      );
      assert.equal(evidence.length, 1, "failed axe scan must not emit PASS");
      assert.equal(excludedHits, 0);
      assert.equal(errors.length, 0);
    } finally {
      await browser.close();
      await Promise.all([
        new Promise<void>((r) => app.close(() => r())),
        new Promise<void>((r) => sink.close(() => r())),
      ]);
    }
  },
);

test(
  "LOCAL_BROWSER: iframe exclusion cannot hide credentials, writes, expiry or an absent exclusion policy",
  { timeout: 30000 },
  async () => {
    let hits = 0;
    const sink = createServer((_req, res) => {
      hits++;
      res.end("must not load");
    });
    sink.listen(0, "127.0.0.1");
    await once(sink, "listening");
    const frameUrl = `http://127.0.0.1:${(sink.address() as { port: number }).port}/map`;
    const app = createServer((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end("<!doctype html><title>Parent</title><main>Parent</main>");
    });
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    const appOrigin = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
    const browser = await chromium.launch({ headless: true });
    try {
      for (const mode of [
        "disabled",
        "authorization",
        "bypass",
        "cookie",
        "post",
        "expired",
      ] as const) {
        const context = await browser.newContext({
          serviceWorkers: "block",
          extraHTTPHeaders:
            mode === "authorization"
              ? { authorization: "Bearer local-session" }
              : mode === "bypass"
                ? { "x-vercel-protection-bypass": "local-bypass" }
                : {},
        });
        try {
          if (mode === "cookie")
            await context.addCookies([
              { name: "credential", value: "local-cookie", url: appOrigin },
            ]);
          const errors: unknown[] = [],
            exclusions: unknown[] = [];
          let expired = false;
          await installReadBoundary(
            context,
            {
              appOrigin,
              authOrigin: "https://auth.invalid",
              blobOrigin: "https://blob.invalid",
              session: "local-session",
              excludeThirdPartyIframes: mode !== "disabled",
            },
            () => {
              if (expired) throw new Error("approval expired");
            },
            (e) => errors.push(e),
            (e) => exclusions.push(e),
          );
          const page = await context.newPage();
          await page.goto(appOrigin);
          expired = mode === "expired";
          const aborted = page.waitForEvent("requestfailed", {
            predicate: (r) => r.url() === frameUrl,
            timeout: 5000,
          });
          await page.evaluate(
            ({ url, post }) => {
              const frame = document.createElement("iframe");
              frame.name = "excluded";
              frame.title = "Map";
              if (!post) frame.src = url;
              document.body.append(frame);
              if (post) {
                const form = document.createElement("form");
                form.method = "POST";
                form.action = url;
                form.target = frame.name;
                document.body.append(form);
                form.submit();
              }
            },
            { url: frameUrl, post: mode === "post" },
          );
          await aborted;
          assert.equal(errors.length, 1, mode);
          const expected =
            mode === "disabled"
              ? "BROWSER_ORIGIN_REFUSED"
              : mode === "post"
                ? "BROWSER_METHOD_REFUSED"
                : mode === "expired"
                  ? "approval expired"
                  : "BROWSER_CREDENTIAL_REFUSED";
          assert.equal((errors[0] as Error).message, expected, mode);
          assert.equal(exclusions.length, 0, mode);
          assert.equal(hits, 0, mode);
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
      await Promise.all([
        new Promise<void>((r) => app.close(() => r())),
        new Promise<void>((r) => sink.close(() => r())),
      ]);
    }
  },
);
