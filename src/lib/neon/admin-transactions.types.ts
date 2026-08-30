export type AdminTransactionVerificationState = "unverified" | "pending" | "verified";

export type AdminTransactionInput = {
  id?: string;
  estate_id: string;
  unit: string | null;
  deal_type: "sale" | "rent";
  price: number;
  saleable_area: number;
  saleable_psf: number;
  deal_date: string;
  block: string | null;
  floor_band: string | null;
  source: string | null;
  source_url: string | null;
  agent_id: string | null;
  /** Content Copilot's generated FB/IG zh-HK copy. Optional so bulk import
   * (AdminTransactionImportRow = AdminTransactionInput) never needs to set
   * them -- a freshly imported row has no social copy yet. */
  social_copy_fb?: string | null;
  social_copy_ig?: string | null;
};

export type AdminTransactionRow = AdminTransactionInput & {
  id: string;
  estate_name_zh: string;
  verification_state: AdminTransactionVerificationState;
  verified_at: string | null;
  published: boolean;
  created_at: string;
};

export type AdminTransactionListFilters = {
  estateId?: string;
  verificationState?: AdminTransactionVerificationState;
  published?: boolean;
  cursor?: string;
  limit?: number;
};

export type AdminTransactionListResult = {
  rows: AdminTransactionRow[];
  nextCursor: string | null;
};

export type AdminTransactionImportRow = AdminTransactionInput;

export type AdminTransactionImportResult = {
  imported: number;
  total: number;
  failure: { position: number; message: string } | null;
};
