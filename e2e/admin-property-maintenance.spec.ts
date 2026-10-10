import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";

declare global {
  interface Window {
    propertyFixture: {
      calls: { name: string; input: unknown }[];
      saveMode: string;
      readFailure: boolean;
      uploadMode: string;
      bulkMode: string;
      actor: string;
      role: string;
      binding: string;
      denied: boolean;
      staffMode: string;
      groupsMode: string;
      linkMode: string;
      linkSeedKey: string;
      pending: { kind: string; release: () => void }[];
      changeContext: (actor: string, role: string, binding?: string) => Promise<void>;
      refreshAuthUser: () => void;
    };
  }
}

// No external base URL is used. The real routes/CSS/components use an owned API model.
let server: Server, origin: string;
const evidence: { name: string; status: string; width: number }[] = [];
test.beforeAll(async () => {
  test.setTimeout(120000);
  assert.ok(!process.env.PLAYWRIGHT_BASE_URL, "Unset external browser target for owned tests");
  const runKey = process.env.EP_PROPERTY_BROWSER_BUILD_RUN;
  assert.ok(!runKey || /^[0-9a-f-]{36}$/i.test(runKey), "Owned run cache key must be UUID");
  const fingerprint = createHash("sha256")
    .update(spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout)
    .update(
      spawnSync(
        "git",
        ["diff", "HEAD", "--", "src", "scripts", "e2e", "package.json", "package-lock.json"],
        { encoding: "utf8" },
      ).stdout,
    )
    .digest("hex");
  const marker = resolve(".audit/remediation-20261003", `ep13-scope-build-${runKey}.json`);
  const entry = resolve(".audit/property-maintenance-browser/index.html");
  let reusable = false;
  if (runKey) {
    try {
      const proof = JSON.parse(await readFile(marker, "utf8"));
      reusable =
        proof.fingerprint === fingerprint &&
        proof.entryHash ===
          createHash("sha256")
            .update(await readFile(entry))
            .digest("hex");
    } catch {
      /* fresh owned invocation */
    }
  }
  if (!reusable) {
    assert.equal(
      spawnSync(process.execPath, ["scripts/browser-fixtures/build-property-maintenance.mjs"], {
        stdio: "inherit",
      }).status,
      0,
    );
    if (runKey) {
      await mkdir(resolve(".audit/remediation-20261003"), { recursive: true });
      await writeFile(
        marker,
        JSON.stringify({
          fingerprint,
          entryHash: createHash("sha256")
            .update(await readFile(entry))
            .digest("hex"),
        }),
      );
    }
  }
  const root = resolve(".audit/property-maintenance-browser");
  server = createServer(async (request, response) => {
    try {
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
  await mkdir(".audit/remediation-20261003", { recursive: true });
  await writeFile(
    ".audit/remediation-20261003/ep13-20-property-scope-browser-summary.json",
    JSON.stringify(
      {
        codeSha: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
        evidenceLayer: "real-routes-synthetic-api-owned-loopback",
        realAuth: false,
        realDatabase: false,
        realMediaProvider: false,
        results: evidence,
      },
      null,
      2,
    ),
  );
});
test.afterEach(async ({ page }, info) =>
  evidence.push({
    name: info.title,
    status: info.status ?? "unknown",
    width: page.viewportSize()!.width,
  }),
);
async function open(page: Page, path = "/admin/listings/A000001") {
  page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin &&
    ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort(),
  );
  await page.goto(origin + path);
  await expect(
    page.getByRole("heading", {
      name: /\/listings\/A\d/.test(path) ? "管理物業" : "樓盤管理",
      exact: true,
    }),
  ).toBeVisible();
}
const saveCalls = (page: Page) =>
  page.evaluate(() => window.propertyFixture.calls.filter((call) => call.name === "save").length);

for (const width of [1440, 1280, 768, 390]) {
  test.describe(`${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("an agent sees no WhatsApp link buttons on 樓盤管理", async ({ page }) => {
      await page.addInitScript(() => sessionStorage.setItem("property-fixture-role", "agent"));
      await open(page, "/admin/listings?pageSize=50&status=all");
      await expect(page.getByRole("link", { name: "#A000001", exact: true })).toBeVisible();
      await expect(page.getByText(/連結建立範圍/)).toHaveCount(0);
      await expect(page.getByRole("button", { name: /WhatsApp 連結/ })).toHaveCount(0);
      await page.getByRole("checkbox", { name: "選擇本頁全部可管理物業", exact: true }).check();
      await expect(page.getByRole("button", { name: /核對修改/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /WhatsApp 連結/ })).toHaveCount(0);
      await page.evaluate(() => window.propertyFixture.changeContext("manager", "manager"));
      await expect(page.getByText(/連結建立範圍/)).toBeVisible();
      await expect(page.getByRole("button", { name: /WhatsApp 連結/ }).first()).toBeVisible();
    });
    test("scope role change clears stale selected properties", async ({ page }) => {
      await open(page, "/admin/listings?pageSize=50&status=all");
      await page.getByRole("checkbox", { name: "選擇本頁全部可管理物業", exact: true }).check();
      await page.evaluate(() => window.propertyFixture.changeContext("manager", "agent"));
      await expect(
        page.getByText("共 5 個物業 · 同一物業的租售只計一次", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("已選 0 個物業", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "#A000006", exact: true })).toHaveCount(0);
      await page.screenshot({
        path: `.audit/remediation-20261003/ep13-20-ep13-scope-role-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
    });
    test("scope staff rebind removes old frozen bulk preview", async ({ page }) => {
      await page.addInitScript(() => sessionStorage.setItem("property-fixture-role", "agent"));
      await open(page, "/admin/listings?pageSize=50&status=all");
      await page.getByRole("checkbox", { name: "選擇本頁全部可管理物業", exact: true }).check();
      await page.getByRole("button", { name: "核對修改（5）", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await page.evaluate(() =>
        window.propertyFixture.changeContext(
          "manager",
          "agent",
          "20000000-0000-4000-8000-000000000002",
        ),
      );
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect(page.getByText("已選 0 個物業", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "#A000001", exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "#A000006", exact: true })).toBeVisible();
      expect(
        await page.evaluate(
          () => window.propertyFixture.calls.filter((c) => c.name === "bulk").length,
        ),
      ).toBe(0);
    });
    for (const outcome of ["delayed", "delayed-denied"])
      test(`scope late property read ${outcome} cannot affect new staff`, async ({ page }) => {
        await open(page, "/admin/listings?pageSize=50&status=all");
        await page.evaluate((mode) => (window.propertyFixture.groupsMode = mode), outcome);
        await page
          .getByRole("combobox", { name: "排序欄位", exact: true })
          .selectOption("propertyNo");
        await expect
          .poll(() =>
            page.evaluate(
              () => window.propertyFixture.pending.filter((p) => p.kind === "groups").length,
            ),
          )
          .toBe(1);
        await page.evaluate(async () => {
          window.propertyFixture.groupsMode = "ok";
          await window.propertyFixture.changeContext("manager", "agent");
        });
        await expect(
          page.getByText("共 5 個物業 · 同一物業的租售只計一次", { exact: true }),
        ).toBeVisible();
        await page.evaluate(async () => {
          window.propertyFixture.pending.find((p) => p.kind === "groups")!.release();
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        });
        await expect(
          page.getByText("共 5 個物業 · 同一物業的租售只計一次", { exact: true }),
        ).toBeVisible();
        await expect(page.getByText("owned old property read denied", { exact: true })).toHaveCount(
          0,
        );
      });
    test("scope unknown lookup hides private list and restoration reloads it", async ({ page }) => {
      await open(page, "/admin/listings?pageSize=50&status=all");
      await page.evaluate(async () => {
        window.propertyFixture.staffMode = "failure";
        await window.propertyFixture.changeContext("manager", "manager");
      });
      await expect(
        page.getByRole("heading", { name: "未能核實職員權限", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "#A000001", exact: true })).toHaveCount(0);
      await page.screenshot({
        path: `.audit/remediation-20261003/ep13-20-ep13-scope-unknown-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      const before = await page.evaluate(
        () => window.propertyFixture.calls.filter((c) => c.name === "groups").length,
      );
      await page.evaluate(async () => {
        window.propertyFixture.staffMode = "ok";
        await window.propertyFixture.changeContext("manager", "manager");
      });
      await expect
        .poll(() =>
          page.evaluate(
            () => window.propertyFixture.calls.filter((c) => c.name === "groups").length,
          ),
        )
        .toBe(before + 1);
      await expect(page.getByRole("link", { name: "#A000001", exact: true })).toBeVisible();
    });
    test("scope initial pending lookup never starts private property reads", async ({ page }) => {
      await page.addInitScript(() =>
        sessionStorage.setItem("property-fixture-staff-mode", "delayed"),
      );
      await page.route("**/*", (route) =>
        new URL(route.request().url()).origin === origin &&
        ["GET", "HEAD"].includes(route.request().method())
          ? route.continue()
          : route.abort(),
      );
      await page.goto(origin + "/admin/listings?pageSize=50&status=all");
      await expect
        .poll(() =>
          page.evaluate(
            () => window.propertyFixture.pending.filter((p) => p.kind === "staff").length,
          ),
        )
        .toBe(1);
      expect(
        await page.evaluate(
          () => window.propertyFixture.calls.filter((c) => c.name === "groups").length,
        ),
      ).toBe(0);
      await page.evaluate(() => {
        window.propertyFixture.staffMode = "ok";
        window.propertyFixture.pending.find((p) => p.kind === "staff")!.release();
      });
      await expect(page.getByRole("link", { name: "#A000001", exact: true })).toBeVisible();
    });
    test("scope same identity recheck retains frozen preview without writes", async ({ page }) => {
      await open(page, "/admin/listings?pageSize=50&status=all");
      await page.getByRole("checkbox", { name: "選擇本頁全部可管理物業", exact: true }).check();
      await page.getByRole("button", { name: "核對修改（50）", exact: true }).click();
      await page.evaluate(() => window.propertyFixture.changeContext("manager", "manager"));
      await expect(page.getByRole("alertdialog")).toContainText("50 個物業");
      expect(
        await page.evaluate(
          () => window.propertyFixture.calls.filter((c) => c.name === "bulk").length,
        ),
      ).toBe(0);
    });
    for (const transition of ["actor", "role", "binding", "aba", "same-context"])
      test(`scope bulk continuation ${transition} preserves accepted chunk only`, async ({
        page,
      }) => {
        await open(page, "/admin/listings?pageSize=50&status=all");
        await page.getByRole("checkbox", { name: "選擇本頁全部可管理物業", exact: true }).check();
        await page.evaluate(() => (window.propertyFixture.bulkMode = "delayed"));
        await page.getByRole("button", { name: "核對修改（50）", exact: true }).click();
        await page.getByRole("button", { name: "確認修改 50 個物業", exact: true }).click();
        await expect
          .poll(() =>
            page.evaluate(
              () => window.propertyFixture.pending.filter((p) => p.kind === "bulk").length,
            ),
          )
          .toBe(1);
        await page.evaluate(async (kind) => {
          if (kind === "actor" || kind === "aba")
            await window.propertyFixture.changeContext("actor-b", "manager");
          if (kind === "aba") await window.propertyFixture.changeContext("manager", "manager");
          if (kind === "role") await window.propertyFixture.changeContext("manager", "agent");
          if (kind === "binding")
            await window.propertyFixture.changeContext(
              "manager",
              "manager",
              "20000000-0000-4000-8000-000000000002",
            );
        }, transition);
        const reads = await page.evaluate(
          () => window.propertyFixture.calls.filter((c) => c.name === "groups").length,
        );
        await page.evaluate(async () => {
          window.propertyFixture.bulkMode = "ok";
          window.propertyFixture.pending.find((p) => p.kind === "bulk")!.release();
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        });
        await expect
          .poll(() =>
            page.evaluate(
              () => window.propertyFixture.calls.filter((c) => c.name === "bulk-return").length,
            ),
          )
          .toBe(transition === "same-context" ? 10 : 1);
        const result = await page.evaluate(() => ({
          calls: window.propertyFixture.calls.filter((c) => c.name === "bulk"),
          reads: window.propertyFixture.calls.filter((c) => c.name === "groups").length,
          saved: JSON.parse(localStorage.getItem("property-fixture-store")!).filter(
            (r: { offerings: { sale: { status: string } } }) =>
              r.offerings.sale.status === "offline",
          ).length,
        }));
        expect(result.calls).toHaveLength(transition === "same-context" ? 10 : 1);
        expect(result.saved).toBe(transition === "same-context" ? 50 : 5);
        expect(result.reads).toBe(transition === "same-context" ? reads + 1 : reads);
        await page.reload();
        await expect(page.getByText("已選 0 個物業", { exact: true })).toBeVisible();
        expect(
          await page.evaluate(
            () => window.propertyFixture.calls.filter((c) => c.name === "bulk").length,
          ),
        ).toBe(0);
      });
    for (const transition of ["actor", "same-context"])
      test(`scope link continuation ${transition} checks identity before seed and navigation`, async ({
        page,
      }) => {
        await open(page, "/admin/listings?pageSize=50&status=all");
        await page.evaluate(() => (window.propertyFixture.linkMode = "delayed"));
        await page
          .getByRole("button", { name: "下一步：預覽 WhatsApp 連結（全部符合篩選）", exact: true })
          .click();
        await expect
          .poll(() =>
            page.evaluate(
              () => window.propertyFixture.pending.filter((p) => p.kind === "link").length,
            ),
          )
          .toBe(1);
        if (transition === "actor")
          await page.evaluate(() => window.propertyFixture.changeContext("actor-b", "manager"));
        if (transition === "actor")
          await page.evaluate(async () => {
            window.propertyFixture.pending.find((p) => p.kind === "link")!.release();
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          });
        else
          await Promise.all([
            page.waitForURL(/\/admin\/whatsapp-links$/),
            page.evaluate(() =>
              window.propertyFixture.pending.find((p) => p.kind === "link")!.release(),
            ),
          ]);
        if (transition === "actor") {
          await expect(page).toHaveURL(/\/admin\/listings\?/);
          expect(
            await page.evaluate(() => sessionStorage.getItem(window.propertyFixture.linkSeedKey)),
          ).toBeNull();
        } else {
          await expect(page).toHaveURL(/\/admin\/whatsapp-links$/);
          const seed = await page.evaluate(() =>
            JSON.parse(sessionStorage.getItem(window.propertyFixture.linkSeedKey)!),
          );
          expect(seed.offers.length).toBeGreaterThan(0);
          expect(seed.scope).toContain("50 個物業");
        }
      });
    test("scope editor downgrade clears inaccessible history and inputs", async ({ page }) => {
      await open(page, "/admin/listings/A000006");
      await page.getByRole("textbox", { name: /^物業介紹/ }).fill("私人的未儲存修改");
      await page.evaluate(() => window.propertyFixture.changeContext("manager", "agent"));
      await expect(page.getByText("找不到物業或沒有存取權限。", { exact: true })).toBeVisible();
      await expect(page.getByRole("textbox", { name: /^物業介紹/ })).toHaveCount(0);
      await expect(page.getByText("樓編號 #A000006", { exact: true })).toHaveCount(0);
    });
    test("scope editor same identity recheck retains unsaved draft", async ({ page }) => {
      await open(page);
      await page.getByRole("textbox", { name: /^物業介紹/ }).fill("同職員保留草稿");
      await page.evaluate(() => window.propertyFixture.changeContext("manager", "manager"));
      await expect(page.getByRole("textbox", { name: /^物業介紹/ })).toHaveValue("同職員保留草稿");
      expect(await saveCalls(page)).toBe(0);
    });
    test("scope auth object renewal retains unsaved editor without a second read", async ({
      page,
    }) => {
      await open(page);
      await page.getByRole("textbox", { name: /^物業介紹/ }).fill("同身份更新仍保留未儲存文字");
      const reads = await page.evaluate(
        () => window.propertyFixture.calls.filter((c) => c.name === "read").length,
      );
      await page.evaluate(async () => {
        window.propertyFixture.readFailure = true;
        window.propertyFixture.refreshAuthUser();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
      expect(
        await page.evaluate(
          () => window.propertyFixture.calls.filter((c) => c.name === "read").length,
        ),
      ).toBe(reads);
      await expect(page.getByRole("textbox", { name: /^物業介紹/ })).toHaveValue(
        "同身份更新仍保留未儲存文字",
      );
      expect(await saveCalls(page)).toBe(0);
    });
    for (const transition of ["actor", "role", "binding", "aba", "same-context"])
      test(`scope editor save continuation ${transition} preserves accepted edit`, async ({
        page,
      }) => {
        await open(page);
        await page.getByRole("textbox", { name: /^物業介紹/ }).fill("已接受的人工作品");
        await page.evaluate(() => (window.propertyFixture.saveMode = "delayed"));
        await page.getByRole("button", { name: "儲存共用資料", exact: true }).click();
        await expect
          .poll(() =>
            page.evaluate(
              () => window.propertyFixture.pending.filter((p) => p.kind === "save").length,
            ),
          )
          .toBe(1);
        await page.evaluate(async (kind) => {
          if (kind === "actor" || kind === "aba")
            await window.propertyFixture.changeContext("actor-b", "manager");
          if (kind === "aba") await window.propertyFixture.changeContext("manager", "manager");
          if (kind === "role") await window.propertyFixture.changeContext("manager", "agent");
          if (kind === "binding")
            await window.propertyFixture.changeContext(
              "manager",
              "manager",
              "20000000-0000-4000-8000-000000000002",
            );
          if (kind === "same-context") {
            await window.propertyFixture.changeContext("manager", "manager");
            window.propertyFixture.refreshAuthUser();
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          }
        }, transition);
        const reads = await page.evaluate(
          () => window.propertyFixture.calls.filter((c) => c.name === "read").length,
        );
        await page.evaluate(async () => {
          window.propertyFixture.pending.find((p) => p.kind === "save")!.release();
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        });
        await expect
          .poll(() =>
            page.evaluate(
              () => window.propertyFixture.calls.filter((c) => c.name === "save-return").length,
            ),
          )
          .toBe(1);
        expect(
          await page.evaluate(
            () => window.propertyFixture.calls.filter((c) => c.name === "read").length,
          ),
        ).toBe(transition === "same-context" ? reads + 1 : reads);
        expect(await saveCalls(page)).toBe(1);
        await expect(page.getByText("已儲存物業資料", { exact: true })).toHaveCount(
          transition === "same-context" ? 1 : 0,
        );
        expect(
          await page.evaluate(
            () =>
              JSON.parse(localStorage.getItem("property-fixture-store")!).find(
                (r: { propertyNo: string }) => r.propertyNo === "A000001",
              ).shared.description,
          ),
        ).toBe("已接受的人工作品");
        await page.reload();
        await expect(page.getByRole("textbox", { name: /^物業介紹/ })).toHaveValue(
          "已接受的人工作品",
        );
        expect(await saveCalls(page)).toBe(0);
      });
    for (const transition of ["actor", "binding", "aba", "same-context"])
      test(`scope upload continuation ${transition} retains accepted media without submitting next file`, async ({
        page,
      }) => {
        await open(page);
        await page.evaluate(() => (window.propertyFixture.uploadMode = "delayed"));
        await page.locator("#property-images").setInputFiles([
          { name: "one.png", mimeType: "image/png", buffer: Buffer.from("owned one") },
          { name: "two.png", mimeType: "image/png", buffer: Buffer.from("owned two") },
        ]);
        await expect
          .poll(() =>
            page.evaluate(
              () => window.propertyFixture.pending.filter((p) => p.kind === "upload").length,
            ),
          )
          .toBe(1);
        await page.evaluate(async (kind) => {
          if (kind === "actor" || kind === "aba")
            await window.propertyFixture.changeContext("actor-b", "manager");
          if (kind === "aba") await window.propertyFixture.changeContext("manager", "manager");
          if (kind === "binding")
            await window.propertyFixture.changeContext(
              "manager",
              "manager",
              "20000000-0000-4000-8000-000000000002",
            );
          if (kind === "same-context") {
            await window.propertyFixture.changeContext("manager", "manager");
            window.propertyFixture.refreshAuthUser();
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          }
        }, transition);
        await page.evaluate(async () => {
          window.propertyFixture.uploadMode = "ok";
          window.propertyFixture.pending.find((p) => p.kind === "upload")!.release();
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        });
        expect(
          await page.evaluate(
            () => window.propertyFixture.calls.filter((c) => c.name === "upload").length,
          ),
        ).toBe(transition === "same-context" ? 2 : 1);
        expect(
          await page.evaluate(
            () => JSON.parse(localStorage.getItem("property-fixture-accepted-uploads")!).length,
          ),
        ).toBe(transition === "same-context" ? 2 : 1);
        await expect(page.getByText(/^已上載 \d 張相片$/, { exact: true })).toHaveCount(
          transition === "same-context" ? 1 : 0,
        );
        await expect(page.getByRole("img", { name: "相片 3", exact: true })).toHaveCount(
          transition === "same-context" ? 1 : 0,
        );
        expect(await saveCalls(page)).toBe(0);
      });
    test("scope property ownership loss on readback clears cached private editor", async ({
      page,
    }) => {
      await page.addInitScript(() => sessionStorage.setItem("property-fixture-role", "agent"));
      await open(page);
      await page.getByRole("textbox", { name: /^物業介紹/ }).fill("已儲存後失去存取權限");
      await page.evaluate(() => (window.propertyFixture.saveMode = "read-fail"));
      await page.getByRole("button", { name: "儲存共用資料", exact: true }).click();
      await expect(
        page.getByText("修改已儲存，但畫面未能更新。請重新載入後繼續。", { exact: true }),
      ).toBeVisible();
      await page.evaluate(() => {
        window.propertyFixture.readFailure = false;
        const rows = JSON.parse(localStorage.getItem("property-fixture-store")!);
        const row = rows.find((r: { propertyNo: string }) => r.propertyNo === "A000001");
        row.offerings.sale.agentId = row.offerings.rent.agentId =
          "20000000-0000-4000-8000-000000000002";
        localStorage.setItem("property-fixture-store", JSON.stringify(rows));
      });
      await page.getByRole("button", { name: "重新載入最新資料", exact: true }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "重新載入", exact: true })
        .click();
      await expect(page.getByText("找不到物業或沒有存取權限。", { exact: true })).toBeVisible();
      await expect(page.getByRole("textbox", { name: /^物業介紹/ })).toHaveCount(0);
      expect(await saveCalls(page)).toBe(1);
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("property-fixture-store")!)[0].shared.description,
        ),
      ).toBe("已儲存後失去存取權限");
    });
    test("publication requires a frozen preview before saving", async ({ page }) => {
      await open(page);
      await page.getByText("1 項資料有差異，請核實", { exact: true }).click();
      await expect(page.getByText("來源差異（出售）：物業介紹", { exact: true })).toBeVisible();
      await expect(page.getByText(/管理：人工保護原文/)).toBeVisible();
      await page.getByText("來源及歷史記錄（1）", { exact: true }).click();
      await expect(page.getByText(/來源更新：.*04:17/)).toBeVisible();
      await page.getByRole("button", { name: "出售設定", exact: true }).click();
      await page.getByRole("combobox", { name: /^出售狀態/ }).selectOption("active");
      await page.getByLabel("售價（港元）", { exact: true }).fill("6200000");
      await page.getByRole("button", { name: "儲存出售設定", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      expect(await saveCalls(page)).toBe(0);
      await expect(page.getByRole("alertdialog")).toContainText("6,200,000");
      await page.getByRole("button", { name: "取消", exact: true }).click();
      await expect(page.getByLabel("售價（港元）", { exact: true })).toHaveValue("6200000");
      await page.getByRole("button", { name: "儲存出售設定", exact: true }).click();
      await page.getByRole("button", { name: "確認公開", exact: true }).click();
      await expect(page.getByText("所有修改已儲存", { exact: true })).toBeVisible();
      expect(await saveCalls(page)).toBe(1);
      await page.reload();
      await page.getByRole("button", { name: "出售設定", exact: true }).click();
      await expect(page.getByLabel("售價（港元）", { exact: true })).toHaveValue("6200000");
      await page.getByRole("button", { name: "出租設定", exact: true }).click();
      await expect(page.getByLabel("月租（港元）", { exact: true })).toHaveValue("18000");
    });
    test("validation retains input and focuses the first invalid field", async ({ page }) => {
      await open(page);
      await page.getByLabel("實用面積（平方呎）", { exact: true }).fill("800.5");
      await page.getByRole("textbox", { name: /^物業介紹/ }).fill("未儲存人工文字");
      await page.getByRole("button", { name: "儲存共用資料", exact: true }).click();
      await expect(page.getByLabel("實用面積（平方呎）", { exact: true })).toBeFocused();
      await expect(page.getByLabel("實用面積（平方呎）", { exact: true })).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await expect(page.getByRole("textbox", { name: /^物業介紹/ })).toHaveValue("未儲存人工文字");
      expect(await saveCalls(page)).toBe(0);
    });
    test("invalid offer amount focuses the amount and dirty scope cancel keeps text", async ({
      page,
    }) => {
      await open(page);
      await page.getByRole("button", { name: "出售設定", exact: true }).click();
      await page.getByLabel("售價（港元）", { exact: true }).fill("-1");
      await page.getByRole("textbox", { name: /^出售補充說明/ }).fill("保留未儲存售盤文字");
      await page.getByRole("button", { name: "儲存出售設定", exact: true }).click();
      await expect(page.getByLabel("售價（港元）", { exact: true })).toBeFocused();
      await expect(page.getByLabel("售價（港元）", { exact: true })).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(await saveCalls(page)).toBe(0);
      await page.getByRole("button", { name: "出租設定", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toContainText("尚未儲存修改");
      await page.getByRole("button", { name: "取消", exact: true }).click();
      await expect(page.getByRole("textbox", { name: /^出售補充說明/ })).toHaveValue(
        "保留未儲存售盤文字",
      );
      await expect(page.getByLabel("售價（港元）", { exact: true })).toHaveValue("-1");
    });
    test("failed upload retains text and photo order survives a fresh page", async ({ page }) => {
      await open(page);
      await page.getByRole("textbox", { name: /^物業介紹/ }).fill("上載失敗後保留文字");
      await page.evaluate(() => (window.propertyFixture.uploadMode = "fail"));
      await page.locator("#property-images").setInputFiles({
        name: "failed.png",
        mimeType: "image/png",
        buffer: Buffer.from("owned fixture"),
      });
      await expect(page.getByText("failed.png：合成媒體服務失敗", { exact: true })).toBeVisible();
      await expect(page.getByRole("textbox", { name: /^物業介紹/ })).toHaveValue(
        "上載失敗後保留文字",
      );
      const second = await page
        .getByRole("img", { name: "相片 2", exact: true })
        .getAttribute("src");
      await page.getByRole("button", { name: "將相片 2 上移", exact: true }).click();
      await page.getByRole("button", { name: "儲存共用資料", exact: true }).click();
      await expect(page.getByText("所有修改已儲存", { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("textbox", { name: /^物業介紹/ })).toHaveValue(
        "上載失敗後保留文字",
      );
      await expect(page.getByRole("img", { name: "相片 1", exact: true })).toHaveAttribute(
        "src",
        second!,
      );
    });
    test("CAS conflict and failed readback retain draft until confirmed reload", async ({
      page,
    }) => {
      await open(page);
      await page.getByRole("textbox", { name: /^物業介紹/ }).fill("衝突未儲存文字");
      await page.evaluate(() => (window.propertyFixture.saveMode = "conflict"));
      await page.getByRole("button", { name: "儲存共用資料", exact: true }).click();
      await expect(
        page.getByText("物業資料已被更新。請重新載入並核對後再提交。", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("textbox", { name: /^物業介紹/ })).toHaveValue("衝突未儲存文字");
      await page.evaluate(() => (window.propertyFixture.saveMode = "read-fail"));
      await page.getByRole("button", { name: "儲存共用資料", exact: true }).click();
      await expect(
        page.getByText("修改已儲存，但畫面未能更新。請重新載入後繼續。", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "儲存共用資料", exact: true })).toBeDisabled();
      await page.evaluate(() => (window.propertyFixture.readFailure = false));
      await page.getByRole("button", { name: "重新載入最新資料", exact: true }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "重新載入", exact: true })
        .click();
      await expect(page.getByText("所有修改已儲存", { exact: true })).toBeVisible();
      await expect(page.getByRole("textbox", { name: /^物業介紹/ })).toHaveValue("衝突未儲存文字");
    });
    test("50 selected properties keep sale-only scope and per-row partial results", async ({
      page,
    }) => {
      await open(page, "/admin/listings?pageSize=50&status=all");
      await page.getByRole("checkbox", { name: "選擇本頁全部可管理物業", exact: true }).check();
      await page.evaluate(() => (window.propertyFixture.bulkMode = "partial"));
      await page.getByRole("button", { name: "核對修改（50）", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toContainText("50 個物業");
      await page.getByRole("button", { name: "確認修改 50 個物業", exact: true }).click();
      await expect(page.getByText("已成功 48 個；未成功或未提交 2 個")).toBeVisible();
      await expect(
        page.getByText("#A000049：物業資料已被更新，請重新載入。", { exact: true }),
      ).toBeVisible();
      const result = await page.evaluate(() => ({
        calls: window.propertyFixture.calls.filter((call) => call.name === "bulk"),
        rows: JSON.parse(localStorage.getItem("property-fixture-store")!),
      }));
      expect(result.calls).toHaveLength(10);
      expect(result.calls.every((call) => (call.input as { scope: string }).scope === "sale")).toBe(
        true,
      );
      expect(
        result.rows.filter(
          (row: { offerings: { sale: { status: string } } }) =>
            row.offerings.sale.status === "offline",
        ),
      ).toHaveLength(48);
      expect(
        result.rows.every(
          (row: { offerings: { rent: { status: string } } }) =>
            row.offerings.rent.status === "active",
        ),
      ).toBe(true);
    });
    test("unknown bulk outcome stops remaining chunks and requires readback", async ({ page }) => {
      await open(page, "/admin/listings?pageSize=50&status=all");
      await page.getByRole("checkbox", { name: "選擇本頁全部可管理物業", exact: true }).check();
      await page.evaluate(() => (window.propertyFixture.bulkMode = "unknown"));
      await page.getByRole("button", { name: "核對修改（50）", exact: true }).click();
      await page.getByRole("button", { name: "確認修改 50 個物業", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "重新載入並核對結果", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => window.propertyFixture.calls.filter((call) => call.name === "bulk").length,
        ),
      ).toBe(1);
      await expect(page.getByRole("button", { name: /^核對修改/ })).toBeDisabled();
      await page.getByRole("button", { name: "重新載入並核對結果", exact: true }).click();
      await expect(page.getByText("已選 0 個物業", { exact: true })).toBeVisible();
      expect(
        await page.evaluate(
          () => window.propertyFixture.calls.filter((call) => call.name === "bulk").length,
        ),
      ).toBe(1);
    });
  });
}
