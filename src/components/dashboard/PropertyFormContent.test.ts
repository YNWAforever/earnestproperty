import { describe, expect, test } from "bun:test";

import {
  applyPropertyContentCopilotPatch,
  buildPropertyContentCopilotFields,
  buildPropertyContentCopilotFingerprintValues,
  normalizePropertyFeatures,
} from "./property-form-content";

describe("property form content helpers", () => {
  test("normalizes one feature per line and removes blank lines", () => {
    expect(normalizePropertyFeatures("  海景  \r\n\n 近地鐵\n  實用率高 ")).toEqual([
      "海景",
      "近地鐵",
      "實用率高",
    ]);
    expect(normalizePropertyFeatures([" 海景 ", "", " 近地鐵"])).toEqual(["海景", "近地鐵"]);
  });

  test("builds only the allowlisted Copilot listing fields", () => {
    expect(
      buildPropertyContentCopilotFields({
        title_zh: " 海景單位 ",
        title_en: " Sea View Home ",
        description: " 描述 ",
        features: " 海景\n\n 近地鐵 ",
        seo_title: " SEO 標題 ",
        seo_description: " SEO 描述 ",
      }),
    ).toEqual({
      title_zh: "海景單位",
      title_en: "Sea View Home",
      description: "描述",
      features: ["海景", "近地鐵"],
      seo_title: "SEO 標題",
      seo_description: "SEO 描述",
    });
  });

  test("maps accepted Copilot patches back to form text without spreading unknown fields", () => {
    const current = {
      title_zh: "舊標題",
      title_en: "",
      description: "舊描述",
      features: "舊特色",
      seo_title: "",
      seo_description: "",
      listing_no: "A-1",
    };

    expect(
      applyPropertyContentCopilotPatch(current, {
        title_zh: "新標題",
        title_en: null,
        features: ["海景", "近地鐵"],
        price: "9999999",
      }),
    ).toEqual({
      ...current,
      title_zh: "新標題",
      title_en: "",
      features: "海景\n近地鐵",
    });
  });

  test("builds a complete persisted listing fingerprint snapshot", () => {
    const snapshot = buildPropertyContentCopilotFingerprintValues({
      id: "listing-id",
      listing_no: "A-1",
      title_zh: "海景單位",
      title_en: null,
      deal_type: "sale",
      price: 5000000,
      rent: null,
      saleable_area: 500,
      gross_area: 650,
      bedrooms: 3,
      bathrooms: 2,
      description: "描述",
      features: ["海景"],
      status: "active",
      district_slug: "sham-tseng",
      estate_id: "estate-id",
      estate_slug: "the-pacifica",
      estate_name_zh: "海之戀",
      estate_district_slug: "tsuen-wan",
      agent_name_zh: "代理",
      agent_name_en: "Agent",
      seo_title: "SEO",
      seo_description: "SEO 描述",
      updated_at: "2026-07-13T00:00:00.000Z",
    });

    expect(Object.keys(snapshot).sort()).toEqual([
      "agent_name_en",
      "agent_name_zh",
      "bathrooms",
      "bedrooms",
      "deal_type",
      "description",
      "district_slug",
      "estate_district_slug",
      "estate_id",
      "estate_name_zh",
      "estate_slug",
      "features",
      "gross_area",
      "id",
      "listing_no",
      "price",
      "rent",
      "saleable_area",
      "seo_description",
      "seo_title",
      "status",
      "title_en",
      "title_zh",
      "updated_at",
    ]);
    expect(snapshot.features).toEqual(["海景"]);
    expect(snapshot.price).toBe(5000000);
  });
});
