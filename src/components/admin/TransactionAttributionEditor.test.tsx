import { test, expect } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TransactionForm } from "../dashboard/TransactionForm";
import { TransactionAttributionEditor } from "./TransactionAttributionEditor";
import {
  buildAttributionInput,
  performanceDateInHongKong,
} from "./transaction-attribution-editor-state";

const id = "00000000-0000-4000-8000-000000000001";
const a = "00000000-0000-4000-8000-000000000002";
const b = "00000000-0000-4000-8000-000000000003";
const form = {
  status: "verified_attributed" as const,
  leadId: "",
  publicListingNo: "A001",
  confirmedAt: "2026-09-20",
  receivable: "100000.00",
  received: "",
  reason: "Signed agreement",
  credits: [
    { staffId: a, branchIdAtClose: null, shareBps: "6000" },
    { staffId: b, branchIdAtClose: null, shareBps: "4000" },
  ],
};
test("60/40 attribution input keeps unknown commission received null", () => {
  const input = buildAttributionInput(form, { transactionId: id, dealType: "sale", version: 0 });
  expect(input.credits.map((c) => c.shareBps)).toEqual([6000, 4000]);
  expect(input.commissionReceived).toBeNull();
  expect(input.publicListingNo).toBe("A001");
});
test("complete attribution cannot save with a partial split", () => {
  expect(() =>
    buildAttributionInput(
      { ...form, credits: [{ ...form.credits[0], shareBps: "9999" }] },
      { transactionId: id, dealType: "sale", version: 0 },
    ),
  ).toThrow();
});
test("editor shows private status, lookup and commission fields separately from publication", () => {
  const html = renderToStaticMarkup(
    createElement(TransactionAttributionEditor, {
      transactionId: id,
      dealType: "sale",
      publicationVerified: false,
    }),
  );
  expect(html).toContain("成交歸因");
  expect(html).toContain("公開樓編");
  expect(html).toContain("關聯客戶");
  expect(html).toContain("應收佣金");
  expect(html).toContain("內部核實");
  expect(html).toContain("公開發布");
});

test("Hong Kong confirmed date round trips across UTC midnight", () => {
  const input = buildAttributionInput(form, { transactionId: id, dealType: "sale", version: 0 });
  expect(performanceDateInHongKong(input.confirmedAt!)).toBe("2026-09-20");
});

test("base form separates source verification from public publication", () => {
  const html = renderToStaticMarkup(createElement(TransactionForm, { onSaved: () => {} }));
  expect(html).toContain("成交來源已核實");
  expect(html).toContain("公開發布");
  expect(html).toContain("內部績效核實在下方成交歸因區處理");
});
