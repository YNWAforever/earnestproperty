import { describe, expect, test } from "bun:test";
import { linkOfferLabel } from "./whatsapp-link-selection";
import {
  changedFields,
  offeringPrice,
  existingOfferingDeals,
  offeringDraft,
  offeringPatch,
  neutralPropertyTitle,
  propertyContentReviewReasons,
} from "./property-management-ui";
describe("property management drafts", () => {
  test("unchanged unresolved shared values are never sent", () => {
    expect(
      changedFields(
        { floor: null, title_zh: "A", images: ["x"] },
        { floor: null, title_zh: "B", images: ["x"] },
      ),
    ).toEqual({ title_zh: "B" });
  });
  test("rental patch cannot include a sale price", () => {
    const offer = {
      id: "1",
      title: "物業",
      dealType: "rent" as const,
      price: 6700000,
      rent: 18000,
      status: "active",
      description: null,
      agentId: null,
      agentName: null,
      editable: true,
    };
    expect(offeringPatch(offer, { ...offeringDraft(offer), amount: "19000" }, "rent")).toEqual({
      rent: 19000,
    });
  });
  test("blank amounts clear explicitly and invalid numbers fail", () => {
    const draft = { amount: "", status: "draft", description: "", agentId: "" };
    expect(offeringPatch(null, draft, "sale").price).toBeNull();
    expect(() => offeringPatch(null, { ...draft, amount: "-1" }, "rent")).toThrow();
  });
  test("neutral title only removes source suffix", () => {
    expect(neutralPropertyTitle("碧堤半島 第07座 租盤 #R075733")).toBe("碧堤半島 第07座");
    expect(neutralPropertyTitle("出售特色單位")).toBe("出售特色單位");
  });
});

test("an absent offer has no price or publication status", () => {
  expect(offeringPrice(null)).toBe("—");
});

test("offer prices use the site price format and keep the 未填價格 fallback", () => {
  const base = {
    id: "o",
    title: "物業",
    status: "active",
    description: null,
    agentId: null,
    agentName: null,
    editable: true,
  };
  expect(offeringPrice({ ...base, dealType: "sale", price: 12_680_000, rent: null })).toBe(
    "HK$1,268萬",
  );
  expect(offeringPrice({ ...base, dealType: "rent", price: null, rent: 38_000 })).toBe(
    "HK$38,000／月",
  );
  expect(offeringPrice({ ...base, dealType: "sale", price: null, rent: null })).toBe("未填價格");
  // Staff confirm and edit prices here, so a rounded 萬 figure keeps the exact amount.
  expect(offeringPrice({ ...base, dealType: "sale", price: 6_200_040, rent: null })).toBe(
    "HK$620萬（HK$6,200,040）",
  );
  // A stored 0 is a real (wrong) value staff must see, not a missing one.
  expect(offeringPrice({ ...base, dealType: "sale", price: 0, rent: null })).toBe("HK$0");
  expect(offeringPrice({ ...base, dealType: "rent", price: null, rent: 0 })).toBe("HK$0");
});

test("WhatsApp link wizard offer labels show the exact price, HK$0 for 0, and 價格待核實 when unset", () => {
  const offer = {
    propertyId: "p",
    publicListingNo: "EP1",
    dealType: "sale" as const,
    title: "物業",
    price: 6_200_040 as number | null,
    agentId: null,
    agentName: null,
  };
  expect(linkOfferLabel(offer)).toBe("EP1 · 售 · 物業 · HK$620萬（HK$6,200,040）");
  expect(linkOfferLabel({ ...offer, price: 0 })).toBe("EP1 · 售 · 物業 · HK$0");
  expect(linkOfferLabel({ ...offer, price: null })).toBe("EP1 · 售 · 物業 · 價格待核實");
  expect(linkOfferLabel({ ...offer, dealType: "rent", price: 18_000 })).toBe(
    "EP1 · 租 · 物業 · HK$18,000／月",
  );
});

test("offer summaries show only real offers and retain non-public statuses", () => {
  const sale = {
    id: "sale",
    title: "物業",
    dealType: "sale" as const,
    price: 6000000,
    rent: null,
    status: "active",
    description: null,
    agentId: null,
    agentName: null,
    editable: true,
  };
  const rent = {
    ...sale,
    id: "rent",
    dealType: "rent" as const,
    price: null,
    rent: 18000,
    status: "inactive",
  };
  expect(existingOfferingDeals({ sale, rent: null })).toEqual(["sale"]);
  expect(existingOfferingDeals({ sale: null, rent })).toEqual(["rent"]);
  expect(existingOfferingDeals({ sale, rent })).toEqual(["sale", "rent"]);
  expect(existingOfferingDeals({ sale: null, rent: null })).toEqual([]);
  expect(rent.status).toBe("inactive");
});

test("content review flags missing estate and contradictory rooms without changing facts", () => {
  const source = { title_zh: "3房套工 VR睇樓", estate_id: null, bedrooms: 4, video_url: null };
  const reasons = propertyContentReviewReasons(source);
  expect(reasons).toHaveLength(3);
  expect(reasons[1]).toContain("工人房不可自行加減");
  expect(source.bedrooms).toBe(4);
});
