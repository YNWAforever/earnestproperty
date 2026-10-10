import type { AdminTransactionRow } from "@/lib/neon/admin-data.types";

/** The form's starting values: the loaded transaction, or blanks for a new one. */
export function createInitialTransactionForm(
  transaction?: AdminTransactionRow,
  staffName?: string,
) {
  return {
    estate_id: transaction?.estate_id ?? "",
    deal_type: (transaction?.deal_type === "rent" ? "rent" : "sale") as "sale" | "rent",
    price: transaction?.price?.toString() ?? "",
    saleable_area: transaction?.saleable_area?.toString() ?? "",
    deal_date: transaction?.deal_date ?? "",
    unit: transaction?.unit ?? "",
    block: transaction?.block ?? "",
    floor_band: transaction?.floor_band ?? "",
    source: transaction?.source ?? staffName ?? "",
    source_url: transaction?.source_url ?? "",
    verified: transaction?.verification_state === "verified",
    published: transaction?.published ?? false,
  };
}

export type TransactionFormState = ReturnType<typeof createInitialTransactionForm>;

/**
 * True only when the form differs from its baseline: the state it was loaded
 * with, or the values last saved. After a save the caller re-baselines to the
 * saved values, so the save's own navigation is never blocked while a LATER
 * edit makes the form dirty again.
 */
export function isTransactionFormDirty(form: TransactionFormState, baseline: TransactionFormState) {
  return (Object.keys(baseline) as Array<keyof TransactionFormState>).some(
    (key) => form[key] !== baseline[key],
  );
}
