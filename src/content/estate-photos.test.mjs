import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getEstateEntry } from "./estate-registry.ts";

const route = readFileSync(new URL("../routes/estate.$slug.tsx", import.meta.url), "utf8");

test("estate heroes and social metadata never fall back to unverified database listing images", () => {
  assert.doesNotMatch(route, /estate\.hero_image/);
  assert.doesNotMatch(route, /屋苑／放盤參考照片/);
});

test("a verified exterior supplies an honest label and preserves attribution", async () => {
  const { getEstateHeroPhoto } = await import("./estate-photos.ts");
  assert.equal(getEstateHeroPhoto(getEstateEntry("bellagio")).src, "/estates/bellagio.jpg");
  const licensed = getEstateHeroPhoto(getEstateEntry("the-carmel"));
  assert.match(licensed.label, /屋苑外觀/);
  assert.match(licensed.credit, /Wikimedia Commons, CC BY-SA 4.0/);
  assert.doesNotMatch(licensed.label, /放盤|全景/);
});

test("listing references, unclassified images, blanks and unknown estates omit the hero", async () => {
  const { getEstateHeroPhoto } = await import("./estate-photos.ts");
  assert.equal(getEstateHeroPhoto(getEstateEntry("peak-castle")), null);
  assert.equal(getEstateHeroPhoto(getEstateEntry("tai-yu")), null);
  assert.equal(getEstateHeroPhoto(undefined), null);
  assert.equal(getEstateHeroPhoto(null), null);
  const entry = getEstateEntry("bellagio");
  assert.equal(getEstateHeroPhoto({ ...entry, photoKind: undefined }), null);
  assert.equal(getEstateHeroPhoto({ ...entry, photo: "" }), null);
  assert.equal(getEstateHeroPhoto({ ...entry, photoKind: "listing" }), null);
});

test("phase exteriors and panoramas have distinct, accurate labels", async () => {
  const { getEstateHeroPhoto } = await import("./estate-photos.ts");
  assert.match(getEstateHeroPhoto(getEstateEntry("sea-crest-villa")).label, /第三期/);
  assert.equal(
    getEstateHeroPhoto({ ...getEstateEntry("bellagio"), photoKind: "panorama" }).label,
    "屋苑全景",
  );
});

test("licensed replacements keep listing provenance separate and expose source and license links", async () => {
  const { getEstateHeroPhoto } = await import("./estate-photos.ts");
  for (const slug of [
    "hong-kong-garden",
    "fei-yeung",
    "napa",
    "hoi-king-garden",
    "l-aquatique",
    "long-tou-waan",
  ]) {
    const entry = getEstateEntry(slug);
    const photo = getEstateHeroPhoto(entry);
    assert.notEqual(photo.src, entry.photo, slug);
    assert.match(photo.src, /^https:\/\/thumb\.wikimedia\.org\//, slug);
    assert.match(photo.sourceUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/, slug);
    assert.equal(photo.licenseUrl, "https://creativecommons.org/licenses/by-sa/4.0/");
    assert.match(photo.credit, /CC BY-SA 4.0/);
    assert.match(photo.label, /屋苑外觀/);
    assert.doesNotMatch(photo.label, /放盤|全景/);
  }
});
