import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./index.tsx", import.meta.url), "utf8");

test("homepage uses Chinese-only large headings for the requested sections", () => {
  for (const title of ["精選筍盤", "精選樓盤影片", "深井核心屋苑", "為何選晉誠"]) {
    assert.match(source, new RegExp(`title=\\"${title}\\"`));
  }

  for (const title of [
    "Featured Listings",
    "Featured Property Videos",
    "Sham Tseng Signature Estates",
    "Why Earnest Property",
  ]) {
    assert.doesNotMatch(source, new RegExp(`title=\\"${title}\\"`));
  }
});

test("homepage keeps the featured video section in the requested order", () => {
  assert.match(source, /FEATURED LISTINGS[\s\S]*精選樓盤影片/);
});

test("section headers only render an eyebrow when one is supplied", () => {
  assert.match(source, /eyebrow\?: string/);
  assert.match(source, /eyebrow \? \(/);
});

test("the future 青山公路／汀九屋苑 block is not added by this slice", () => {
  assert.doesNotMatch(source, /青山公路及汀九屋苑/);
});
