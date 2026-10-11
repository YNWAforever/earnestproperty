import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";

/**
 * FX-20: every shadcn primitive in every state (rest, disabled, busy, focus, pressed, hover),
 * rendered from the real styles.css and the real SiteFooter by an owned fixture
 * (scripts/browser-fixtures/design-states). Loopback only: every other request is aborted.
 */

let server: Server, origin: string;
let pageErrors: string[] = [];

test.beforeAll(async () => {
  test.setTimeout(120000);
  assert.ok(!process.env.PLAYWRIGHT_BASE_URL);
  assert.equal(
    spawnSync(process.execPath, ["scripts/browser-fixtures/build-design-states.mjs"], {
      stdio: "inherit",
    }).status,
    0,
  );
  const root = resolve(".audit/design-states-browser");
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
          {
            ".js": "text/javascript",
            ".css": "text/css",
            ".html": "text/html",
            ".png": "image/png",
            ".webp": "image/webp",
            ".svg": "image/svg+xml",
            ".woff2": "font/woff2",
          } as Record<string, string>
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
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('[data-surface="dark"] footer')).toBeVisible();
}

test("the states sheet renders at 375 and 1440 px", async ({ page }) => {
  const dir = resolve(".audit/design-states-playwright");
  await mkdir(dir, { recursive: true });
  await page.setViewportSize({ width: 375, height: 900 });
  await open(page);
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: resolve(dir, `design-states-${width}.png`), fullPage: true });
  }
});

type FocusReading = {
  key: string;
  focusVisible: boolean;
  kind: string;
  width: number;
  ratio: number;
  detail: string;
};

/**
 * Reads the focus indicator of the focused element: an outline, or the outermost Tailwind ring
 * (a 0-offset, 0-blur box-shadow with spread). Its width is the visible band (ring spread minus
 * the offset band inside it); its contrast is the lower of the ratios against the colour just
 * outside it (the nearest opaque background behind the element) and the colour just inside it
 * (the offset band, the gap of an outline-offset, or the element's own background).
 */
function readFocus(key: string): FocusReading | null {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return null;
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  ctx.canvas.width = ctx.canvas.height = 1;
  const rgba = (c: string): number[] => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const over = (fg: number[], bg: number[]) =>
    [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
  const lum = (c: number[]) => {
    const [r, g, b] = c
      .slice(0, 3)
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: number[], b: number[]) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const layers: number[][] = [];
  let opacity = 1;
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    opacity *= Number(getComputedStyle(node).opacity);
    if (node === el) continue;
    const bg = rgba(getComputedStyle(node).backgroundColor);
    if (bg[3] > 0) layers.push(bg);
    if (bg[3] >= 1) break;
  }
  const outside = layers.reverse().reduce((acc, layer) => over(layer, acc), [255, 255, 255, 1]);
  const cs = getComputedStyle(el);
  const own = rgba(cs.backgroundColor);
  const ownOver = own[3] > 0 ? over(own, outside) : outside;
  const seen = (c: number[], inner: number[]) => {
    const drawn = over([c[0], c[1], c[2], c[3] * opacity], outside);
    const innerDrawn = over([inner[0], inner[1], inner[2], opacity], outside);
    return Math.min(contrast(drawn, outside), contrast(drawn, innerDrawn));
  };
  const candidates: FocusReading[] = [];
  const base = { key, focusVisible: el.matches(":focus-visible") };
  if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) {
    const color = rgba(cs.outlineColor);
    const inner = parseFloat(cs.outlineOffset) > 0 ? outside : ownOver;
    candidates.push({
      ...base,
      kind: `outline ${cs.outlineStyle}`,
      width: parseFloat(cs.outlineWidth),
      ratio: seen(color, inner),
      detail: `${cs.outlineColor} offset ${cs.outlineOffset}`,
    });
  }
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of cs.boxShadow === "none" ? "" : cs.boxShadow) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  const rings = parts
    .map((part) => {
      const color = part.match(/^(?:[a-z-]+\([^)]*\)|#[0-9a-f]+|[a-z]+)/i)?.[0] ?? "transparent";
      const nums = part
        .slice(color.length)
        .trim()
        .split(/\s+/)
        .filter((t) => t !== "inset")
        .map(parseFloat);
      return { color: rgba(color), inset: /\binset\b/.test(part), nums, raw: part };
    })
    .filter((s) => !s.inset && s.nums[0] === 0 && s.nums[1] === 0 && !s.nums[2] && s.nums[3] > 0)
    .sort((a, b) => a.nums[3] - b.nums[3]);
  if (rings.length) {
    const ring = rings[rings.length - 1];
    const band = rings.length > 1 ? rings[rings.length - 2] : null;
    candidates.push({
      ...base,
      kind: "ring",
      width: ring.nums[3] - (band ? band.nums[3] : 0),
      ratio: seen(ring.color, band ? over(band.color, ownOver) : ownOver),
      detail: rings.map((r) => r.raw).join(" | "),
    });
  }
  if (!candidates.length) return { ...base, kind: "none", width: 0, ratio: 1, detail: "" };
  return candidates.sort((a, b) => b.width * b.ratio - a.width * a.ratio)[0];
}

function focusKey(): string | null {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return null;
  if (el.dataset.focus) return el.dataset.focus;
  if (el.getAttribute("role") === "slider") return "slider";
  if (el.tagName === "A" && el.closest('[data-surface="page"]')) return "link-page";
  if (el.tagName === "A" && el.closest('[data-surface="dark"]')) return "link-footer";
  return null;
}

const FOCUS_TARGETS = [
  "button-default",
  "button-brand",
  "button-destructive",
  "button-outline",
  "button-secondary",
  "button-ghost",
  "button-link",
  "input",
  "textarea",
  "select",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "tab",
  "accordion",
  "link-page",
  "dialog-trigger",
  "link-footer",
];

test("every control shows a focus indicator after Tab: at least 2 px and 3:1 beside it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const readings = new Map<string, FocusReading>();
  for (let i = 0; i < 400 && readings.size < FOCUS_TARGETS.length; i++) {
    await page.keyboard.press("Tab");
    const key = await page.evaluate(focusKey);
    if (!key || readings.has(key)) continue;
    // Read the settled focus style, not the first frame of a colour/shadow transition.
    await page.waitForTimeout(250);
    readings.set(key, (await page.evaluate(readFocus, key))!);
  }
  await page.getByRole("button", { name: "開啟對話框" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')))
    .toBe(true);
  if (!(await page.evaluate(() => document.activeElement?.matches(":focus-visible")))) {
    await page.keyboard.press("Tab");
  }
  await page.waitForTimeout(250);
  readings.set("dialog-close", (await page.evaluate(readFocus, "dialog-close"))!);
  await page.keyboard.press("Escape");

  const failures = [...FOCUS_TARGETS, "dialog-close"]
    .map((key) => readings.get(key) ?? ({ key, kind: "never focused" } as FocusReading))
    .filter((r) => !r.focusVisible || !(r.width >= 2) || !(r.ratio >= 3))
    .map((r) => `${r.key}: ${r.kind} ${r.width}px ${r.ratio?.toFixed(2)}:1 ${r.detail ?? ""}`);
  expect(failures).toEqual([]);
});

test("a mouse click does not show the ring on a button", async ({ page }) => {
  await open(page);
  const button = page.locator('[data-focus="button-brand"]');
  await button.click();
  expect(await button.evaluate((el) => el.matches(":focus-visible"))).toBe(false);
  const reading = await page.evaluate(readFocus, "button-brand");
  expect(reading?.kind === "none" || reading!.width < 2).toBe(true);
});

test("a disabled button is 50% and not clickable; a busy button stays readable", async ({
  page,
}) => {
  await open(page);
  const styles = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-state-name]")]
      .filter((el) => el.dataset.stateName !== "rest")
      .map((el) => {
        const cs = getComputedStyle(el);
        const variant = el.closest<HTMLElement>("[data-variant]")!.dataset.variant;
        const size = el.closest<HTMLElement>("[data-size]")!.dataset.size;
        return `${variant}/${size}/${el.dataset.stateName} opacity ${cs.opacity} pointer ${cs.pointerEvents} cursor ${cs.cursor}`;
      }),
  );
  const expected = styles.map((line) =>
    line.replace(/\/(disabled|busy) opacity .*$/, (_, name: string) =>
      name === "busy"
        ? "/busy opacity 1 pointer none cursor progress"
        : "/disabled opacity 0.5 pointer none cursor default",
    ),
  );
  expect(styles.length).toBe(7 * 4 * 2);
  expect(styles).toEqual(expected);
});

test("a pressed button scales to 0.98, not with reduced motion and never when disabled", async ({
  page,
}) => {
  await open(page);
  const pressedScale = async (selector: string) => {
    const box = (await page.locator(selector).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(300);
    const scale = await page.locator(selector).evaluate((el) => getComputedStyle(el).scale);
    await page.mouse.up();
    await page.waitForTimeout(300);
    return scale;
  };
  const rest = '[data-variant="brand"] [data-size="default"] [data-state-name="rest"]';
  const disabled = '[data-variant="brand"] [data-size="default"] [data-state-name="disabled"]';
  expect(await pressedScale(rest)).toBe("0.98");
  expect(await pressedScale(disabled)).toBe("none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await pressedScale(rest)).toBe("none");
});

test("badges do not change background on hover", async ({ page }) => {
  await open(page);
  for (const variant of ["default", "secondary", "destructive", "outline"]) {
    const badge = page.locator(`[data-badge="${variant}"]`);
    const before = await badge.evaluate((el) => getComputedStyle(el).backgroundColor);
    await badge.hover();
    await page.waitForTimeout(300);
    const after = await badge.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(after, variant).toBe(before);
    await page.mouse.move(0, 0);
  }
});

test("input, textarea and select trigger borders are at least 3:1 against the card", async ({
  page,
}) => {
  await open(page);
  const ratios = await page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    ctx.canvas.width = ctx.canvas.height = 1;
    const rgb = (c: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const lum = (c: number[]) => {
      const [r, g, b] = c
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const card = document.querySelector('[data-surface="card"]')!;
    const cardColor = rgb(getComputedStyle(card).backgroundColor);
    return [...document.querySelectorAll<HTMLElement>("[data-field]")].map((el) => {
      const border = lum(rgb(getComputedStyle(el).borderTopColor));
      const [hi, lo] = [border, lum(cardColor)].sort((a, b) => b - a);
      return [el.dataset.field!, Number(((hi + 0.05) / (lo + 0.05)).toFixed(2))] as const;
    });
  });
  expect(ratios.map(([field]) => field)).toEqual(["input", "textarea", "select"]);
  for (const [field, ratio] of ratios) expect(ratio, field).toBeGreaterThanOrEqual(3);
});
