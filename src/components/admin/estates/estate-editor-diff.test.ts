import { expect, test } from "bun:test";
import { cmsFieldDiff } from "@/lib/admin/cms-field-diff";
import { ESTATE_EDITOR_LABELS } from "./estate-editor-labels";

// The standalone editor keeps every field as a string (facilities and aliases one per line)
// and diffs its pristine state against the form with its own labels.
const pristine = {
  id: "estate-1",
  slug: "sea-view",
  name_zh: "海景花園",
  name_en: "",
  area_min: "500",
  facilities: "會所\n泳池",
  aliases: "",
  address: "舊地址",
  lat: "22.3",
  verified_at: null as string | null,
};

test("a clean editor has nothing unsaved, even where number formatting differs", () => {
  expect(
    cmsFieldDiff(
      "estate",
      pristine,
      { ...pristine, area_min: "500.0", lat: "22.30" },
      ESTATE_EDITOR_LABELS,
    ),
  ).toEqual({ changes: [], otherChanged: 0 });
});

test("edited editor fields are named with the editor's own labels, including fields the CMS dialog lacks", () => {
  const { changes, otherChanged } = cmsFieldDiff(
    "estate",
    pristine,
    {
      ...pristine,
      area_min: "650",
      facilities: "會所",
      address: "新地址",
      verified_at: "2026-10-08T09:15:00.000Z",
    },
    ESTATE_EDITOR_LABELS,
  );
  expect(changes.map((change) => change.label)).toEqual([
    "面積下限",
    "設施（每行一項）",
    "地址",
    "核實狀態",
  ]);
  expect(changes.find((change) => change.key === "verified_at")?.after).toBe("08/10/2026 17:15");
  expect(otherChanged).toBe(0);
});

test("every editor field has a label, so none is reported as a system field", () => {
  for (const key of Object.keys(pristine).filter((key) => key !== "id"))
    expect(ESTATE_EDITOR_LABELS[key]).toBeTruthy();
});
