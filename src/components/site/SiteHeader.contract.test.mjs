import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const headerSource = await readFile(new URL("./SiteHeader.tsx", import.meta.url), "utf8");
const homeSource = await readFile(new URL("../../routes/index.tsx", import.meta.url), "utf8");
const sheetSource = await readFile(new URL("../ui/sheet.tsx", import.meta.url), "utf8");

test("mega menu omits redundant group-purpose copy but keeps navigation labels", () => {
  for (const purpose of [
    "按深井、青山公路、汀九或屋苑入口瀏覽。",
    "由買樓、租樓、放盤估價到聯絡門市。",
    "影片、成交、屋苑開箱與市場分析集中入口。",
  ]) {
    assert.doesNotMatch(headerSource, new RegExp(purpose));
  }

  for (const label of ["地區與屋苑", "買租服務", "市場資訊"]) {
    assert.match(headerSource, new RegExp(label));
  }
});

test("homepage hero uses the approved 20 percent tighter responsive padding", () => {
  assert.match(
    homeSource,
    /className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8 lg:py-28"/,
  );
});

// DR-8: the mobile nav opens via <Sheet>, and the vendored shadcn primitive's
// screen-reader-only close label was still the upstream English "Close" on an
// otherwise zh-HK site.
test("SiteHeader's mobile Sheet close control is zh-HK, not the vendored English default", () => {
  assert.match(headerSource, /from "@\/components\/ui\/sheet"/);
  assert.doesNotMatch(sheetSource, /<span className="sr-only">Close<\/span>/);
  assert.match(sheetSource, /<span className="sr-only">關閉<\/span>/);
});
