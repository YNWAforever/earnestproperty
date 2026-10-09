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
 * True only when the form differs from the state it was loaded with. Once the
 * record is saved nothing is left to lose, so the leave guard must not fire on
 * the save's own navigation.
 */
export function isTransactionFormDirty(
  form: TransactionFormState,
  pristine: TransactionFormState,
  saved: boolean,
) {
  if (saved) return false;
  return (Object.keys(pristine) as Array<keyof TransactionFormState>).some(
    (key) => form[key] !== pristine[key],
  );
}
