import { describe, expect, test } from "bun:test";

import { DESCRIPTION_MAX_UNITS, TITLE_MAX_UNITS, displayWidth } from "@/content/seo-budget.js";
import { agentSeo } from "./agent-seo";
import type { AgentSeoInput } from "./agent-seo";

const fullProfile: AgentSeoInput = {
  name_zh: "陳大文",
  name_en: "Tommy Chan",
  job_title: "高級營業經理",
  licence_no: "E-123456",
  branch_name: "麗都分行",
  specialties: ["海景豪宅", "收租盤"],
  served_estate_slugs: ["bellagio", "sea-crest-villa", "hong-kong-garden"],
};

describe("agentSeo", () => {
  test("names the agent, the role, the district and the estates they serve", () => {
    const { title, description } = agentSeo(fullProfile);
    // All three served estates carry districtSlug "sham-tseng" -- 豪景花園's
    // row does too, even though the homepage groups it under 青山公路 (see
    // estate-registry.ts's EstateHomepageDistrict comment). The head uses the
    // real district, not the display grouping.
    expect(title).toBe("陳大文 高級營業經理｜深井地產代理｜晉誠地產");
    expect(description).toContain("駐麗都分行");
    expect(description).toContain("碧堤半島");
    expect(description).toContain("牌照 E-123456／C-018613。");
    expect(displayWidth(title)).toBeLessThanOrEqual(TITLE_MAX_UNITS);
    expect(displayWidth(description)).toBeLessThanOrEqual(DESCRIPTION_MAX_UNITS);
  });

  test("two agents on the same roster do not share a description", () => {
    // The defect: every profile shipped the same 30-character tail with only
    // a name and a job title varying.
    const a = agentSeo(fullProfile);
    const b = agentSeo({
      ...fullProfile,
      name_zh: "李小明",
      job_title: "營業員",
      licence_no: "E-654321",
      branch_name: "海韻分行",
      served_estate_slugs: ["mun-ming-shan", "sing-tai"],
    });
    expect(a.title).not.toBe(b.title);
    expect(a.description).not.toBe(b.description);
    // 掃管笏 is not a districtSlug: those estates sit under "castle-peak-road".
    expect(b.title).toContain("青山公路");
  });

  test("treats a blank job_title as absent instead of rendering a stray space", () => {
    // The old head used `job_title ?? "晉誠地產專業代理"`, so an empty-string
    // column won the fallback and left a hole in the sentence.
    for (const job_title of ["", "   "]) {
      const { title, description } = agentSeo({ ...fullProfile, job_title });
      expect(title).not.toContain("  ");
      expect(title.startsWith("陳大文｜")).toBe(true);
      expect(description).toContain("晉誠地產持牌地產代理");
      expect(description).not.toContain("，，");
    }
  });

  test("falls back to the English name when there is no Chinese one", () => {
    // Every roster agent has name_zh NULL today, so this is the live path.
    const { title } = agentSeo({ ...fullProfile, name_zh: null });
    expect(title.startsWith("Tommy Chan 高級營業經理")).toBe(true);
  });

  test("gives an unnamed published profile honest agency copy, not a stencil", () => {
    const { title, description } = agentSeo({ name_zh: null, name_en: "  " });
    expect(title).toBe("晉誠地產持牌代理｜深井 青山公路 汀九買樓租樓");
    expect(description).toContain("C-018613。");
    expect(description).not.toContain("undefined");
    expect(displayWidth(description)).toBeLessThanOrEqual(DESCRIPTION_MAX_UNITS);
  });

  test("omits the individual licence number when the column is empty", () => {
    const { description } = agentSeo({ ...fullProfile, licence_no: null });
    expect(description).toContain("晉誠地產 C-018613。");
    expect(description).not.toContain("牌照 ");
  });

  test("omits the branch when it is not recorded, rather than defaulting one", () => {
    // agent-directory.ts documents why a missing branch is never defaulted to
    // SITE_BRANCHES[0]: it printed 麗都分行 on agents based elsewhere.
    const { description } = agentSeo({ ...fullProfile, branch_name: null });
    expect(description).not.toContain("駐");
  });

  test("falls back to specialties, then to the corridor, when no estates are served", () => {
    const withSpecialties = agentSeo({ ...fullProfile, served_estate_slugs: [] });
    expect(withSpecialties.description).toContain("專責海景豪宅、收租盤");

    const bare = agentSeo({ ...fullProfile, served_estate_slugs: [], specialties: [] });
    expect(bare.description).toContain("專營深井 青山公路 汀九");
  });

  test("ignores a served slug that is not a real estate", () => {
    const { description } = agentSeo({
      ...fullProfile,
      served_estate_slugs: ["not-an-estate", "bellagio"],
    });
    expect(description).toContain("碧堤半島");
    expect(description).not.toContain("not-an-estate");
  });

  test("stays inside both budgets for the longest realistic profile", () => {
    const { title, description } = agentSeo({
      name_zh: "陳大文",
      name_en: "Tommy Chan Tai Man",
      job_title: "首席高級營業董事及分行經理",
      licence_no: "E-1234567",
      branch_name: "青山公路豪景花園分行",
      served_estate_slugs: estateSlugsOfEveryDistrict,
      specialties: ["海景豪宅", "收租盤", "洋房", "新盤"],
    });
    expect(displayWidth(title)).toBeLessThanOrEqual(TITLE_MAX_UNITS);
    expect(displayWidth(description)).toBeLessThanOrEqual(DESCRIPTION_MAX_UNITS);
    expect(title.endsWith("｜晉誠地產")).toBe(true);
    expect(description.endsWith("。")).toBe(true);
  });
});

/** One estate from each of the registry's three districts, plus more, so the
 * width test exercises the longest area and estate lists the data allows. */
const estateSlugsOfEveryDistrict = [
  "bellagio",
  "hong-kong-garden",
  "mun-ming-shan",
  "sea-crest-villa",
  "the-carmel",
  "tai-tou-waan",
];
