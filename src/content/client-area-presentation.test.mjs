import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  approvedPresentationEstateSlugs,
  clientAreaGroups,
  clientAreaGroupsInNavOrder,
  clientAreaGroupsInSchematicOrder,
  getClientAreaGroup,
  isApprovedPresentationEstate,
  unresolvedClientEstateLabels,
} from "./client-area-presentation.ts";
import { estateRegistry, getEstateEntry } from "./estate-registry.ts";
import { isWithinCorridorRegion, corridorRegionScope } from "./castle-peak-road.ts";

const ledger = readFileSync(
  new URL("../../docs/client-feedback-20260907-ledger.md", import.meta.url),
  "utf8",
);

test("every referenced slug resolves to a real registry entry", () => {
  for (const slug of approvedPresentationEstateSlugs) {
    assert.ok(getEstateEntry(slug), `${slug} must exist in the registry`);
  }
});

test("no estate is claimed by two groups or two tiers", () => {
  assert.equal(
    new Set(approvedPresentationEstateSlugs).size,
    approvedPresentationEstateSlugs.length,
  );
});

test("the two context-specific orders are stored separately and genuinely differ", () => {
  assert.deepEqual(
    clientAreaGroupsInNavOrder().map((group) => group.key),
    ["sham-tseng", "castle-peak-road-west", "yau-kom-tau-ting-kau"],
  );
  assert.deepEqual(
    clientAreaGroupsInSchematicOrder().map((group) => group.key),
    ["yau-kom-tau-ting-kau", "sham-tseng", "castle-peak-road-west"],
  );
});

test("every shortcut points at a route that already exists", () => {
  // Never an invented route with no loader or content. The western group
  // anchors the 青山公路 overview's 主要屋苑 section instead.
  const allowed = new Set([
    "/district/sham-tseng",
    "/castle-peak-road#main-estates",
    "/castle-peak-road/ting-kau",
  ]);
  for (const group of clientAreaGroups) {
    assert.ok(allowed.has(group.href), `${group.href} must be an existing entry point`);
  }
});

test("香港黃金海岸 is eligible again without widening the corridor", () => {
  // Its own canonical name contains 黃金海岸, one of the place names the
  // corridor gate rejects -- which is why it never appeared anywhere.
  assert.ok(corridorRegionScope.outOfScopeTextAliases.includes("黃金海岸"));
  assert.ok(isApprovedPresentationEstate("wong-gam-hoi-ngon"));
  assert.equal(
    isWithinCorridorRegion({
      districtSlug: "castle-peak-road",
      estateSlug: "wong-gam-hoi-ngon",
      text: ["香港黃金海岸"],
    }),
    true,
  );
});

test("the allowance is per estate, and does not admit unrelated stock", () => {
  // A 屯門 listing with no estate: still rejected.
  assert.equal(
    isWithinCorridorRegion({
      districtSlug: "castle-peak-road",
      estateSlug: null,
      text: ["屯門青山公路住宅盤源"],
    }),
    false,
  );
  // A 大欖涌 listing: still rejected.
  assert.equal(
    isWithinCorridorRegion({
      districtSlug: "castle-peak-road",
      estateSlug: null,
      text: ["大欖涌盤源"],
    }),
    false,
  );
  // A generic castle-peak-road row whose text names an out-of-scope place is
  // still rejected even though the district slug alone would have passed.
  assert.equal(
    isWithinCorridorRegion({
      districtSlug: "castle-peak-road",
      estateSlug: null,
      text: ["掃管笏花園盤源"],
    }),
    false,
  );
  // An unapproved estate gets no allowance.
  assert.equal(isApprovedPresentationEstate("some-other-estate"), false);
  assert.equal(isApprovedPresentationEstate(null), false);
});

test("every unresolved client name is carried verbatim and never invented into the registry", () => {
  const labels = unresolvedClientEstateLabels.map((entry) => entry.label);
  assert.deepEqual(labels, [
    "逸璟瓏灣",
    "NAPA",
    "凱和山",
    "緹岸",
    "飛揚",
    "翠濤居",
    "棕月灣",
    "愛琴灣",
  ]);
  for (const label of labels) {
    assert.ok(
      !estateRegistry.some((entry) => entry.nameZh === label || entry.nameEn === label),
      `${label} must not have been invented as an estate identity`,
    );
    assert.ok(
      ledger.includes(label),
      `${label} must appear in the requirement ledger as an open question`,
    );
  }
});

test("棕月灣 and 愛琴灣 are not silently resolved to similarly-named estates", () => {
  const claimed = new Set(approvedPresentationEstateSlugs);
  // 愛琴海岸 is a different estate from the client's 愛琴灣 and keeps its own place.
  assert.ok(claimed.has("oi-kam-hoi-ngon"));
  assert.equal(getEstateEntry("oi-kam-hoi-ngon").nameZh, "愛琴海岸");
  assert.ok(!unresolvedClientEstateLabels.some((entry) => entry.label === "愛琴海岸"));
});

test("其他 never becomes an estate identity", () => {
  assert.ok(!approvedPresentationEstateSlugs.includes("其他"));
  assert.ok(!estateRegistry.some((entry) => entry.nameZh === "其他"));
  assert.ok(!unresolvedClientEstateLabels.some((entry) => entry.label === "其他"));
});

test("presentation labels never fork an estate's canonical identity", () => {
  const withLabels = clientAreaGroups
    .flatMap((group) => [...group.primary, ...group.secondary])
    .filter((ref) => ref.presentationLabel);
  assert.deepEqual(
    withLabels.map((ref) => [ref.slug, ref.presentationLabel]),
    [
      ["hoi-wan-toi", "海韻台"],
      ["tai-yu", "帝御系列"],
    ],
  );
  for (const ref of withLabels) {
    const entry = getEstateEntry(ref.slug);
    assert.notEqual(entry.nameZh, ref.presentationLabel, "a label only exists where it differs");
    assert.equal(
      getClientAreaGroup(
        clientAreaGroups.find((group) =>
          [...group.primary, ...group.secondary].some((member) => member.slug === ref.slug),
        ).key,
      ).key !== undefined,
      true,
    );
  }
});
