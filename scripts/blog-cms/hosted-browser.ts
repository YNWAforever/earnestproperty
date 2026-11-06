import { installReadBoundary } from "./hosted-browser-boundary";
import { exerciseRecovery } from "./hosted-recovery";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium, expect, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  PAGES,
  VIEWPORTS,
  TAGS,
  expectCurrentLinksMatchPath,
  expectOneBlogFilterCurrent,
  expectPaginationCurrentIs,
  expectNoSmallRunningChinese,
} from "../../e2e/a11y-checks";
import { roles, sha256, checklist, type HostedInput, type Role } from "./hosted-contract";

type State = Awaited<ReturnType<BrowserContext["storageState"]>>;
export async function runHostedRecovery(
  p: HostedInput,
  env: NodeJS.ProcessEnv,
  expected: { path: string; title: string }[],
  guard: () => void,
  faults: { enable(): Promise<void>; restore(): Promise<void> },
  failedRpc: (name: "pageServer" | "articleServer") => Promise<number>,
  cache: (headers: Headers) => void,
) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ baseURL: p.target.origin, serviceWorkers: "block" });
    const boundaryErrors: unknown[] = [];
    await installReadBoundary(
      context,
      {
        appOrigin: p.target.origin,
        authOrigin: p.target.auth.origin,
        blobOrigin: `https://${p.target.blob.host}`,
        bypass: env.HOSTED_VERCEL_BYPASS,
      },
      guard,
      (e) => boundaryErrors.push(e),
    );
    const pages = new Map<string, Page>();
    return await exerciseRecovery(p, expected, {
      ...faults,
      failedRpc,
      now: Date.now,
      async unavailable(path) {
        guard();
        const page = await context.newPage();
        pages.set(path, page);
        const response = await page.goto(path, { timeout: 15000 });
        assert.equal(response?.status(), 500, "RECOVERY_UNAVAILABLE_HTTP");
        cache(new Headers(await response!.allHeaders()));
        await expect(
          page.getByRole("heading", { name: "文章暫時未能載入", exact: true }),
        ).toBeVisible({ timeout: 10000 });
        await expect(page.getByRole("button", { name: "重試", exact: true })).toBeVisible({
          timeout: 10000,
        });
        assert.deepEqual(boundaryErrors, [], "RECOVERY_BROWSER_BOUNDARY");
        return { path, unavailableStatus: 500, unavailableVisible: true, retryVisible: true };
      },
      async recover(path, title) {
        guard();
        const page = pages.get(path)!;
        const id = path === "/blog" ? p.functions.pageServer : p.functions.articleServer;
        const received = page.waitForResponse(
          (r) =>
            new URL(r.url()).origin === p.target.origin &&
            new URL(r.url()).pathname === "/_serverFn/" + id,
          { timeout: 15000 },
        );
        await page.getByRole("button", { name: "重試", exact: true }).click({ timeout: 10000 });
        const response = await received;
        assert.equal(response.status(), 200, "RECOVERY_RETRY_HTTP");
        cache(new Headers(await response.allHeaders()));
        await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible({
          timeout: 10000,
        });
        assert.equal(new URL(page.url()).origin, p.target.origin);
        assert.deepEqual(boundaryErrors, []);
        return { recoveredStatus: 200, recoveredTitle: await page.locator("h1").innerText() };
      },
    });
  } finally {
    await browser.close();
  }
}
export function readBrowserStates(p: HostedInput, env: NodeJS.ProcessEnv): Record<Role, State> {
  return Object.fromEntries(
    roles.map((role) => {
      const bytes = readFileSync(env[`HOSTED_${role.toUpperCase()}_STORAGE_STATE`] ?? "");
      assert.equal(sha256(bytes), p.actors[role].browserStateSha256, "browser actor state binding");
      const state = JSON.parse(bytes.toString()) as State;
      assert.ok(Array.isArray(state.cookies) && Array.isArray(state.origins));
      const origins = [p.target.origin, p.target.auth.origin];
      for (const origin of state.origins)
        assert.ok(origins.includes(origin.origin), "storage origin mismatch");
      for (const cookie of state.cookies) {
        assert.ok(
          origins.some((o) => new URL(o).hostname === cookie.domain),
          "wildcard/foreign cookie refused",
        );
        assert.ok(cookie.secure && (cookie.expires === -1 || cookie.expires * 1000 > Date.now()));
      }
      assert.ok(state.cookies.length + state.origins.length > 0, "empty actor storage");
      return [role, state];
    }),
  ) as Record<Role, State>;
}
export async function runHostedBrowser(
  p: HostedInput,
  env: NodeJS.ProcessEnv,
  states: Record<Role, State>,
  guard: () => void,
  evidence: (row: unknown) => void,
) {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of VIEWPORTS) {
      let boundaryFailure = false;
      const makeContext = async (role?: Role) => {
        const context = await browser.newContext({
          baseURL: p.target.origin,
          viewport,
          isMobile: viewport.mobile,
          hasTouch: viewport.mobile,
          serviceWorkers: "block",
          ...(role ? { storageState: states[role] } : {}),
        });
        await installReadBoundary(
          context,
          {
            appOrigin: p.target.origin,
            authOrigin: p.target.auth.origin,
            blobOrigin: `https://${p.target.blob.host}`,
            session: role ? env[`HOSTED_${role.toUpperCase()}_SESSION`] : undefined,
            bypass: env.HOSTED_VERCEL_BYPASS,
          },
          guard,
          (error) => {
            boundaryFailure = true;
            evidence({
              kind: "browser-boundary-failure",
              code: error instanceof Error ? error.message : "BROWSER_BOUNDARY_FAILED",
            });
          },
        );
        return context;
      };
      const scan = async (page: Page, label: string) => {
        guard();
        assert.equal(new URL(page.url()).origin, p.target.origin);
        assert.equal(boundaryFailure, false, "browser identity/approval boundary failed");
        const axe = await new AxeBuilder({ page }).withTags(TAGS).exclude("iframe").analyze();
        assert.deepEqual(
          axe.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
          [],
          label,
        );
        await expectCurrentLinksMatchPath(page);
        const url = new URL(page.url());
        if (url.pathname === "/blog") await expectOneBlogFilterCurrent(page);
        if (url.pathname === "/listings" && url.searchParams.get("page") === "2")
          await expectPaginationCurrentIs(page, "2");
        if (viewport.mobile) await expectNoSmallRunningChinese(page);
        evidence({ kind: "a11y", label, viewport: viewport.width, status: "PASS", tags: TAGS });
      };
      const context = await makeContext();
      try {
        const page = await context.newPage();
        for (const target of [
          ...PAGES,
          ...checklist.pages.map((path) => ({ name: path, path })),
          ...checklist.articles.map((a) => ({ name: a.slug, path: a.path })),
        ]) {
          const path = typeof target.path === "string" ? target.path : await target.path(page);
          assert.ok(path, "required dynamic a11y page missing");
          const response = await page.goto(path);
          assert.equal(response?.status(), path.startsWith("/zz-fx16-not-found") ? 404 : 200);
          await page.waitForLoadState("networkidle");
          await scan(page, target.name);
        }
      } finally {
        await context.close();
      }
      for (const role of roles) {
        const context = await makeContext(role);
        try {
          const page = await context.newPage();
          assert.equal((await page.goto("/admin/cms?tab=articles"))?.status(), 200);
          const session = await page.evaluate(async (base) => {
            const response = await fetch(base + "/get-session", {
              credentials: "include",
              cache: "no-store",
            });
            if (response.status !== 200) throw new Error("HOSTED_SESSION_UNAVAILABLE");
            const raw = await response.json();
            return raw?.data ?? raw;
          }, p.target.auth.baseUrl);
          assert.equal(session?.user?.id, p.actors[role].userId, "browser auth identity binding");
          assert.equal(
            sha256(session?.session?.token ?? ""),
            p.actors[role].sessionSha256,
            "browser real session binding",
          );
          await expect(page.getByRole("region", { name: "網誌管理" })).toBeVisible();
          await scan(page, "cms-list:" + role);
          await page
            .getByRole("button", { name: /^編輯 / })
            .first()
            .click();
          await expect(page.getByLabel("標題", { exact: true })).toBeVisible();
          await scan(page, "cms-editor:" + role);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
}
