import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
// Type-only: also brings in the fixture's `window.publicFormsFixture` declaration.
import type { PublicFormsFixtureMode as FixtureMode } from "../scripts/browser-fixtures/public-forms/synthetic-api";

/**
 * Real-browser regression for the four public enquiry forms (FX-01). The actual form components
 * render against synthetic server functions (scripts/browser-fixtures/public-forms), so every
 * outcome -- including TanStack's "rate-limited call resolves with a Response" -- is driven
 * deterministically with no database, provider or network.
 */

const FORMS = ["contact", "property", "valuation", "alert"] as const;
type FormKey = (typeof FORMS)[number];

const NAME = "陳大文";
const PHONE = "91234567";
const ADDRESS = "合成測試花園 1座 10樓 A室";
const PROPERTY_ID = "00000000-0000-4000-8000-000000000001";

const COPY = {
  RATE_LIMITED: "提交次數太多，請一分鐘後再試，或直接 WhatsApp 我們。",
  NETWORK: "網絡連線出現問題，請檢查網絡後再試，或直接 WhatsApp 我們。",
  SERVER: "未能提交，請再試一次，或直接 WhatsApp 我們。",
  contactSuccess: "已收到查詢，我們會盡快聯絡你。",
};
const RAW_SERVER_TEXT = ["Too Many Requests", "Failed to fetch"];
const CALL_NAME: Record<FormKey, string> = {
  contact: "createWebsiteInquiry",
  property: "createWebsiteInquiry",
  valuation: "createValuationLead",
  alert: "createListingAlert",
};
const SUBMIT_LABEL: Record<FormKey, string> = {
  contact: "提交查詢",
  property: "提交查詢",
  valuation: "提交估價查詢",
  alert: "設定通知",
};
const SUCCESS_PANEL: Partial<Record<FormKey, string>> = {
  valuation: "已收到查詢",
  alert: "已設定通知",
};
const CONSENT_MESSAGE: Partial<Record<FormKey, string>> = {
  valuation: "請先剔選同意先可以提交",
  alert: "請先剔選同意通知先可以提交",
};

let server: Server, origin: string;
let pageErrors: string[] = [];

test.beforeAll(async () => {
  test.setTimeout(120000);
  assert.ok(!process.env.PLAYWRIGHT_BASE_URL);
  assert.equal(
    spawnSync(process.execPath, ["scripts/browser-fixtures/build-public-forms.mjs"], {
      stdio: "inherit",
    }).status,
    0,
  );
  const root = resolve(".audit/public-forms-browser");
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
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== "passed") return;
  expect(pageErrors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

const section = (page: Page, form: FormKey) => page.locator(`section[data-form="${form}"]`);
const submitButton = (page: Page, form: FormKey) =>
  section(page, form).getByRole("button", { name: SUBMIT_LABEL[form], exact: true });
const calls = (page: Page) => page.evaluate(() => window.publicFormsFixture.calls);
const setMode = (page: Page, mode: FixtureMode) =>
  page.evaluate((mode) => (window.publicFormsFixture.mode = mode), mode);

async function open(page: Page) {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin &&
    ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort(),
  );
  await page.goto(origin + "/");
  for (const form of FORMS) await expect(submitButton(page, form)).toBeVisible();
  expect(await calls(page)).toEqual([]);
}

async function fill(page: Page, form: FormKey, { consent = true } = {}) {
  const s = section(page, form);
  await s.getByLabel("姓名 *", { exact: true }).fill(NAME);
  await s.getByLabel("電話 *", { exact: true }).fill(PHONE);
  if (form === "contact") {
    await s.getByRole("combobox", { name: "查詢類型 *", exact: true }).click();
    await page.getByRole("option", { name: "買樓", exact: true }).click();
    await s.getByRole("combobox", { name: "偏好聯絡方式 *", exact: true }).click();
    await page.getByRole("option", { name: "WhatsApp", exact: true }).click();
  }
  if (form === "valuation") {
    await s.getByLabel("物業地址 / 屋苑 *", { exact: true }).fill(ADDRESS);
  }
  if (consent && (form === "valuation" || form === "alert")) {
    await s.getByRole("checkbox").check();
  }
}

async function expectTypedValuesKept(page: Page, form: FormKey) {
  const s = section(page, form);
  await expect(s.getByLabel("姓名 *", { exact: true })).toHaveValue(NAME);
  await expect(s.getByLabel("電話 *", { exact: true })).toHaveValue(PHONE);
  if (form === "contact") {
    await expect(s.getByRole("combobox", { name: "查詢類型 *", exact: true })).toHaveText("買樓");
    await expect(s.getByRole("combobox", { name: "偏好聯絡方式 *", exact: true })).toHaveText(
      "WhatsApp",
    );
  }
  if (form === "valuation") {
    await expect(s.getByLabel("物業地址 / 屋苑 *", { exact: true })).toHaveValue(ADDRESS);
  }
  if (form === "valuation" || form === "alert") {
    await expect(s.getByRole("checkbox")).toBeChecked();
  }
}

/** The form shows exactly this error, no success line and no success panel. */
async function expectOnlyError(page: Page, form: FormKey, message: string) {
  const s = section(page, form);
  await expect(s.getByRole("alert")).toHaveText(message);
  await expect(s.getByRole("status")).toHaveCount(0);
  const panel = SUCCESS_PANEL[form];
  if (panel) await expect(s.getByText(panel, { exact: true })).toHaveCount(0);
  await expect(submitButton(page, form)).toBeEnabled();
}

async function expectNoRawServerText(page: Page) {
  for (const raw of RAW_SERVER_TEXT) await expect(page.locator("body")).not.toContainText(raw);
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const form of FORMS) {
      test(`rate-limited response shows RATE_LIMITED copy in role=alert and keeps typed values (${form})`, async ({
        page,
      }) => {
        await open(page);
        await setMode(page, "rate-limited-response");
        await fill(page, form);
        await submitButton(page, form).click();
        await expectOnlyError(page, form, COPY.RATE_LIMITED);
        await expectTypedValuesKept(page, form);
        expect((await calls(page)).map((call) => call.name)).toEqual([CALL_NAME[form]]);
        await expectNoRawServerText(page);
      });
    }

    for (const form of ["contact", "valuation"] as const) {
      test(`no-id result shows SERVER copy and no success status (${form})`, async ({ page }) => {
        await open(page);
        await setMode(page, "no-id");
        await fill(page, form);
        await submitButton(page, form).click();
        await expectOnlyError(page, form, COPY.SERVER);
        await expectTypedValuesKept(page, form);
        expect((await calls(page)).map((call) => call.name)).toEqual([CALL_NAME[form]]);
      });
    }

    test("network failure shows NETWORK copy (property)", async ({ page }) => {
      await open(page);
      await setMode(page, "network");
      await fill(page, "property");
      await submitButton(page, "property").click();
      await expectOnlyError(page, "property", COPY.NETWORK);
      await expectTypedValuesKept(page, "property");
      expect(await calls(page)).toEqual([
        {
          name: "createWebsiteInquiry",
          input: {
            data: expect.objectContaining({
              name: NAME,
              phone: PHONE,
              property_id: PROPERTY_ID,
              consentWhatsapp: false,
            }),
          },
        },
      ]);
      await expectNoRawServerText(page);
    });

    test("success shows contact success copy in role=status and clears the form (contact)", async ({
      page,
    }) => {
      await open(page);
      await fill(page, "contact");
      const s = section(page, "contact");
      await s.getByRole("checkbox").check();
      await submitButton(page, "contact").click();
      await expect(s.getByRole("status")).toHaveText(COPY.contactSuccess);
      await expect(s.getByRole("alert")).toHaveCount(0);
      await expect(s.getByLabel("姓名 *", { exact: true })).toHaveValue("");
      await expect(s.getByLabel("電話 *", { exact: true })).toHaveValue("");
      await expect(s.getByRole("combobox", { name: "查詢類型 *", exact: true })).toHaveText(
        "請選擇查詢類型",
      );
      await expect(s.getByRole("combobox", { name: "偏好聯絡方式 *", exact: true })).toHaveText(
        "請選擇偏好聯絡方式",
      );
      await expect(s.getByRole("checkbox")).not.toBeChecked();
      expect(await calls(page)).toEqual([
        {
          name: "createWebsiteInquiry",
          input: {
            data: expect.objectContaining({ name: NAME, phone: PHONE, consentWhatsapp: true }),
          },
        },
      ]);
    });

    test("success shows 已收到查詢 panel (valuation)", async ({ page }) => {
      await open(page);
      await fill(page, "valuation");
      await submitButton(page, "valuation").click();
      const s = section(page, "valuation");
      await expect(s.getByText("已收到查詢", { exact: true })).toBeVisible();
      await expect(s.getByRole("alert")).toHaveCount(0);
      await expect(s.getByLabel("姓名 *", { exact: true })).toHaveCount(0);
      expect(await calls(page)).toEqual([
        {
          name: "createValuationLead",
          input: {
            data: expect.objectContaining({
              name: NAME,
              phone: PHONE,
              propertyAddress: ADDRESS,
              consent: true,
            }),
          },
        },
      ]);
    });

    for (const form of ["valuation", "alert"] as const) {
      test(`consent unticked shows consent message and records no call (${form})`, async ({
        page,
      }) => {
        await open(page);
        await fill(page, form, { consent: false });
        const s = section(page, form);
        await expect(s.getByRole("checkbox")).not.toBeChecked();
        // The visible guard: the submit button stays disabled until consent is ticked, so a click
        // or an Enter keypress cannot submit at all.
        await expect(submitButton(page, form)).toBeDisabled();
        await s.getByLabel("姓名 *", { exact: true }).press("Enter");
        await expect(s.getByRole("alert")).toHaveCount(0);
        // The handler's own guard, reached by a programmatic submit that bypasses the disabled
        // button (the only way to fire the form's submit event without consent).
        await s.locator("form").evaluate((element: HTMLFormElement) => element.requestSubmit());
        await expect(s.getByRole("alert")).toHaveText(CONSENT_MESSAGE[form]!);
        await expect(s.getByRole("status")).toHaveCount(0);
        await expect(s.getByText(SUCCESS_PANEL[form]!, { exact: true })).toHaveCount(0);
        expect(await calls(page)).toEqual([]);
      });
    }

    test("double click while held records exactly one contact call", async ({ page }) => {
      await open(page);
      const s = section(page, "contact");
      const submit = submitButton(page, "contact");

      // A real pointer double click: the second click lands while the first call is held.
      await setMode(page, "hold");
      await fill(page, "contact");
      await submit.dblclick();
      await expect(s.getByRole("button", { name: "提交中…", exact: true })).toBeDisabled();
      expect(await calls(page)).toHaveLength(1);
      await expect(s.getByRole("status")).toHaveCount(0);
      await expect(s.getByRole("alert")).toHaveCount(0);
      await page.evaluate(() => window.publicFormsFixture.release());
      await expect(s.getByRole("status")).toHaveText(COPY.contactSuccess);
      expect(await calls(page)).toHaveLength(1);

      // Two clicks in one task, before React can re-render the button as disabled. Only
      // createSubmitGuard stands between the second submit event and a second call.
      await fill(page, "contact");
      const enabledAtSecondClick = await submit.evaluate((button: HTMLButtonElement) => {
        button.click();
        const enabled = !button.disabled;
        button.click();
        return enabled;
      });
      expect(enabledAtSecondClick).toBe(true);
      expect(await calls(page)).toHaveLength(2);
      await expect(s.getByRole("status")).toHaveCount(0);
      await page.evaluate(() => window.publicFormsFixture.release());
      await expect(s.getByRole("status")).toHaveText(COPY.contactSuccess);
      expect((await calls(page)).map((call) => call.name)).toEqual([
        "createWebsiteInquiry",
        "createWebsiteInquiry",
      ]);
    });

    test("error then corrected retry shows only the success status (contact)", async ({ page }) => {
      await open(page);
      const s = section(page, "contact");
      await setMode(page, "network");
      await fill(page, "contact");
      await submitButton(page, "contact").click();
      await expectOnlyError(page, "contact", COPY.NETWORK);
      await expectTypedValuesKept(page, "contact");

      await setMode(page, "success");
      await submitButton(page, "contact").click();
      await expect(s.getByRole("status")).toHaveText(COPY.contactSuccess);
      await expect(s.getByRole("status")).toHaveCount(1);
      await expect(s.getByRole("alert")).toHaveCount(0);
      expect(await calls(page)).toHaveLength(2);
    });

    test("no raw server text visible", async ({ page }) => {
      await open(page);
      for (const form of FORMS) {
        await setMode(page, "rate-limited-response");
        await fill(page, form);
        await submitButton(page, form).click();
        await expectOnlyError(page, form, COPY.RATE_LIMITED);
        await expectNoRawServerText(page);

        await setMode(page, "network");
        await submitButton(page, form).click();
        await expectOnlyError(page, form, COPY.NETWORK);
        await expectNoRawServerText(page);
      }
      expect(await calls(page)).toHaveLength(FORMS.length * 2);
      const text = await page.evaluate(() => document.body.innerText);
      for (const raw of RAW_SERVER_TEXT) expect(text).not.toContain(raw);
    });
  });
}
