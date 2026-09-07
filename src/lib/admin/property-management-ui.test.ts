import { describe, expect, test } from "bun:test";
import {
  changedFields,
  offeringPrice,
  existingOfferingDeals,
  offeringDraft,
  offeringPatch,
  neutralPropertyTitle,
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
