import { describe, expect, test } from "bun:test";

import type { AdminTransactionRow } from "@/lib/neon/admin-data.types";

import { createInitialTransactionForm, isTransactionFormDirty } from "./transaction-form-state";

const loaded = {
  id: "t1",
  estate_id: "11111111-1111-4111-8111-111111111111",
  deal_type: "sale",
  price: 8_500_000,
  saleable_area: 600,
  deal_date: "2026-05-01",
  unit: "A",
  block: "1",
  floor_band: "中層",
  source: "土地註冊處",
  source_url: "",
  verification_state: "verified",
  published: true,
} as unknown as AdminTransactionRow;

describe("transaction form dirty state", () => {
  test("a loaded transaction is clean; one edited field is dirty; saving makes it clean", () => {
    const pristine = createInitialTransactionForm(loaded, "Staff");
    expect(isTransactionFormDirty({ ...pristine }, pristine)).toBe(false);
    const edited = { ...pristine, price: "9000000" };
    expect(isTransactionFormDirty(edited, pristine)).toBe(true);
    // Saving re-baselines to the saved values.
    expect(isTransactionFormDirty(edited, edited)).toBe(false);
  });

  test("after a save, a further edit is dirty again and reverting it is clean", () => {
    const pristine = createInitialTransactionForm(loaded, "Staff");
    const saved = { ...pristine, price: "9000000" };
    expect(isTransactionFormDirty({ ...saved, unit: "9Z" }, saved)).toBe(true);
    expect(isTransactionFormDirty({ ...saved, unit: pristine.unit }, saved)).toBe(false);
  });

  test("a new blank form is clean until a field is typed into", () => {
    const pristine = createInitialTransactionForm(undefined, "Staff");
    expect(isTransactionFormDirty({ ...pristine }, pristine)).toBe(false);
    expect(isTransactionFormDirty({ ...pristine, unit: "5B" }, pristine)).toBe(true);
  });
});
