import { describe, test, expect } from "bun:test";
import {
  publicPropertyNo,
  publicPropertyTitle,
  verifiedVrTourUrl,
  propertyUpdatedAt,
  propertyPriceSummary,
  propertyDealLabel,
  activePropertyOfferings,
  selectPropertyOffering,
} from "./property-public";
const sale = {
  id: "s",
  listing_no: "B-1-S",
  deal_type: "sale" as const,
  price: 6480000,
  rent: null,
  status: "active",
  description: "sale copy",
};
const rent = {
  id: "r",
  listing_no: "B-1-R",
  deal_type: "rent" as const,
  price: null,
  rent: 18500,
  status: "active",
  description: "rent copy",
};
const unit = { ...sale, public_listing_no: "B", offerings: [sale, rent] };
describe("unified property presentation", () => {
  test("stable URL and both independently priced offerings", () => {
    expect(publicPropertyNo(unit)).toBe("B");
    expect(propertyPriceSummary(unit)).toContain("6.48M");
    expect(propertyPriceSummary(unit)).toContain("18,500");
    expect(propertyDealLabel(unit)).toBe("可買可租");
  });
  test("rent inquiry targets rent row and never inherits sale price", () => {
    expect(selectPropertyOffering(unit, "rent")).toEqual(rent);
    expect(selectPropertyOffering(unit, "rent")?.description).toBe("rent copy");
  });
  test("withdrawn rent cannot be selected or shown as available", () => {
    const withdrawn = { ...unit, offerings: [sale, { ...rent, status: "inactive" }] };
    expect(activePropertyOfferings(withdrawn)).toEqual([sale]);
    expect(selectPropertyOffering(withdrawn, "rent")).toEqual(sale);
    expect(propertyPriceSummary(withdrawn)).not.toContain("18,500");
  });
  test("legacy data keeps its own identity", () => {
    expect(publicPropertyNo(sale)).toBe("B-1-S");
    expect(activePropertyOfferings(sale)).toEqual([sale]);
  });
});

test("rented archive retains the rental label when no offers remain", () => {
  expect(propertyDealLabel({ ...rent, status: "rented", offerings: [] })).toBe("租盤");
});

test("public cards use actual available update times for new and legacy inventory", () => {
  expect(
    propertyUpdatedAt({
      created_at: "2026-09-07T02:00:00Z",
      updated_at: "2026-09-07T06:00:00Z",
      last_seen_at: null,
    }),
  ).toBe("2026-09-07T06:00:00Z");
  expect(
    propertyUpdatedAt({
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-02T00:00:00Z",
      last_seen_at: "2026-08-24T00:00:00Z",
    }),
  ).toBe("2026-08-24T00:00:00Z");
  expect(
    propertyUpdatedAt({ created_at: "invalid", updated_at: null, last_seen_at: null }),
  ).toBeNull();
});
test("an imported internal SYNC identifier is never a customer listing number", () => {
  expect(publicPropertyNo({ listing_no: "SYNC-00000000-0000-4000-8000-000000000001" })).toBe("");
  expect(
    publicPropertyNo({
      listing_no: "SYNC-00000000-0000-4000-8000-000000000001",
      public_listing_no: "A074714",
    }),
  ).toBe("A074714");
});

test("public title removes promotional artifacts without rewriting source room counts", () => {
  const raw = "【筍盤】!!!3房套工 Patry Room VR睇樓!!";
  const property = { ...sale, title_zh: raw };
  expect(publicPropertyTitle(property)).toBe("3房套工 Party Room");
  expect(property.title_zh).toBe(raw);
});

test("VR claims need a supported HTTPS tour rather than a video or title keyword", () => {
  const title = "星堤 VR實景 3房套";
  expect(
    publicPropertyTitle({ ...sale, title_zh: title, video_url: "https://youtu.be/abcdefghijk" }),
  ).toBe("星堤 3房套");
  expect(publicPropertyTitle({ ...sale, title_zh: "VR 實景 3房套", video_url: null })).toBe(
    "3房套",
  );
  expect(verifiedVrTourUrl("https://youtu.be/abcdefghijk?feature=vr")).toBeNull();
  const tour = "https://my.matterport.com/show/?m=abc123";
  expect(verifiedVrTourUrl(tour)).toBe(tour);
  expect(publicPropertyTitle({ ...sale, title_zh: title, video_url: tour })).toBe(title);
  expect(verifiedVrTourUrl("http://my.matterport.com/show/?m=abc123")).toBeNull();
});
