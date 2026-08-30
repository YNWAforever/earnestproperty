import "@tanstack/react-start/server-only";

import type { StaffAccess } from "./auth.server.ts";
import {
  dateOrNull,
  numberOrNull,
  queryRows as defaultQueryRows,
  stringOrEmpty,
  stringOrNull,
} from "./db.server.ts";
import type {
  AdminTransactionImportResult,
  AdminTransactionInput,
  AdminTransactionListFilters,
  AdminTransactionListResult,
  AdminTransactionRow,
} from "./admin-transactions.types";

type WriteAudit = (
  actorId: string | null,
  action: string,
  subjectType?: string,
  subjectId?: string,
  metadata?: Record<string, unknown>,
) => Promise<void>;

// Dynamically imported (not a static top-level import) so this file can be
// imported directly by node --test without pulling in admin-data.server.ts's
// own extensionless internal imports, which only resolve through Vite's
// bundler -- exactly the same reason admin-data.ts's requireStaff() helper
// dynamically imports auth.server rather than importing it statically.
const defaultWriteAudit: WriteAudit = async (...args) => {
  const adminData = await import("./admin-data.server.ts");
  return adminData.writeAudit(...args);
};

type Dependencies = {
  queryRows?: typeof defaultQueryRows;
  writeAudit?: WriteAudit;
};

function validateTransactionInput(input: AdminTransactionInput) {
  if (!input.estate_id) throw new Error("請選擇屋苑");
  if (!(input.price > 0)) throw new Error("成交價必須大於零");
  if (!(input.saleable_area > 0)) throw new Error("實用面積必須大於零");
  const expectedPsf = input.price / input.saleable_area;
  const deviation = Math.abs(input.saleable_psf - expectedPsf) / expectedPsf;
  if (deviation > 0.05) {
    throw new Error(
      `實呎叫價 $${input.saleable_psf} 與成交價/面積計算值 $${Math.round(expectedPsf)} 不符（超過 5%），請確認`,
    );
  }
  const dealDate = new Date(input.deal_date);
  if (Number.isNaN(dealDate.getTime())) throw new Error("成交日期格式錯誤");
  if (dealDate.getTime() > Date.now()) throw new Error("成交日期不能是未來日期");
}

// Only a change to one of these triggers the pending-demotion in
// saveAdminTransaction -- agent_id (an assignment, not a fact about the
// deal) and the two social-copy fields never do, so touching up FB/IG
// copy on an already-verified, published transaction doesn't silently
// pull it off the public site.
const FACTUAL_FIELDS = [
  "estate_id",
  "unit",
  "deal_type",
  "price",
  "saleable_area",
  "saleable_psf",
  "deal_date",
  "block",
  "floor_band",
  "source",
  "source_url",
] as const;

const NUMERIC_FACTUAL_FIELDS = new Set(["price", "saleable_area", "saleable_psf"]);

function factualFieldChanged(
  existing: Record<string, unknown>,
  input: AdminTransactionInput,
  field: (typeof FACTUAL_FIELDS)[number],
): boolean {
  const after = input[field];
  if (field === "deal_date") {
    return dateOrNull(existing.deal_date)?.slice(0, 10) !== after;
  }
  const before = existing[field];
  if (before == null && after == null) return false;
  // Postgres numeric columns commonly round-trip as strings through the
  // driver (see mapTransactionRow's own numberOrNull() coercion just below)
  // -- comparing those directly against the input's JS numbers would treat
  // "6000000" !== 6000000 as a change on every single save.
  if (NUMERIC_FACTUAL_FIELDS.has(field)) {
    return Number(before) !== Number(after);
  }
  return before !== after;
}

function mapTransactionRow(row: Record<string, unknown>): AdminTransactionRow {
  return {
    id: stringOrEmpty(row.id),
    estate_id: stringOrEmpty(row.estate_id),
    estate_name_zh: stringOrEmpty(row.estate_name_zh),
    unit: stringOrNull(row.unit),
    deal_type: row.deal_type === "rent" ? "rent" : "sale",
    price: numberOrNull(row.price) ?? 0,
    saleable_area: numberOrNull(row.saleable_area) ?? 0,
    saleable_psf: numberOrNull(row.saleable_psf) ?? 0,
    deal_date: dateOrNull(row.deal_date) ?? "",
    block: stringOrNull(row.block),
    floor_band: stringOrNull(row.floor_band),
    source: stringOrNull(row.source),
    source_url: stringOrNull(row.source_url),
    agent_id: stringOrNull(row.agent_id),
    social_copy_fb: stringOrNull(row.social_copy_fb),
    social_copy_ig: stringOrNull(row.social_copy_ig),
    verification_state:
      row.verification_state === "verified" || row.verification_state === "pending"
        ? row.verification_state
        : "unverified",
    verified_at: dateOrNull(row.verified_at),
    published: row.published === true,
    created_at: dateOrNull(row.created_at) ?? "",
  };
}

export function createAdminTransactionsService(dependencies: Dependencies = {}) {
  const queryRows = dependencies.queryRows ?? defaultQueryRows;
  const writeAudit = dependencies.writeAudit ?? defaultWriteAudit;

  async function listAdminTransactions(
    filters: AdminTransactionListFilters,
  ): Promise<AdminTransactionListResult> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.estateId) {
      params.push(filters.estateId);
      conditions.push(`t.estate_id = $${params.length}`);
    }
    if (filters.verificationState) {
      params.push(filters.verificationState);
      conditions.push(`t.verification_state = $${params.length}::transaction_verification_state`);
    }
    if (filters.published !== undefined) {
      params.push(filters.published);
      conditions.push(`t.published = $${params.length}`);
    }
    const limit = Math.min(Math.max(filters.limit ?? 40, 1), 100);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = await queryRows(
      `SELECT t.*, e.name_zh AS estate_name_zh
       FROM transactions t
       JOIN estates e ON e.id = t.estate_id
       ${where}
       ORDER BY t.created_at DESC
       LIMIT ${limit + 1}`,
      params,
    );
    const hasMore = rows.length > limit;
    return {
      rows: rows.slice(0, limit).map(mapTransactionRow),
      nextCursor: hasMore ? stringOrEmpty(rows[limit - 1]?.id) || null : null,
    };
  }

  async function getAdminTransaction(id: string): Promise<AdminTransactionRow | null> {
    const rows = await queryRows(
      `SELECT t.*, e.name_zh AS estate_name_zh FROM transactions t
       JOIN estates e ON e.id = t.estate_id WHERE t.id = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ? mapTransactionRow(rows[0]) : null;
  }

  async function saveAdminTransaction(input: AdminTransactionInput, actor: StaffAccess) {
    validateTransactionInput(input);

    let resetToPending = false;
    if (input.id) {
      const current = await queryRows("SELECT * FROM transactions WHERE id = $1", [input.id]);
      const existing = current[0];
      if (existing?.verification_state === "verified") {
        resetToPending = FACTUAL_FIELDS.some((field) => factualFieldChanged(existing, input, field));
      }
    }

    const rows = await queryRows(
      `INSERT INTO transactions
         (id, estate_id, unit, deal_type, price, saleable_area, saleable_psf, deal_date,
          block, floor_band, source, source_url, agent_id, social_copy_fb, social_copy_ig
          ${resetToPending ? ", verification_state, verified_at" : ""})
       VALUES
         (COALESCE($1, gen_random_uuid()), $2, $3, $4::deal_type, $5, $6, $7, $8::date,
          $9, $10, $11, $12, $13, $14, $15
          ${resetToPending ? ", 'pending', NULL" : ""})
       ON CONFLICT (id) DO UPDATE SET
         estate_id = EXCLUDED.estate_id, unit = EXCLUDED.unit, deal_type = EXCLUDED.deal_type,
         price = EXCLUDED.price, saleable_area = EXCLUDED.saleable_area,
         saleable_psf = EXCLUDED.saleable_psf, deal_date = EXCLUDED.deal_date,
         block = EXCLUDED.block, floor_band = EXCLUDED.floor_band,
         source = EXCLUDED.source, source_url = EXCLUDED.source_url, agent_id = EXCLUDED.agent_id,
         social_copy_fb = EXCLUDED.social_copy_fb, social_copy_ig = EXCLUDED.social_copy_ig
         ${resetToPending ? ", verification_state = 'pending', verified_at = NULL" : ""}
       RETURNING id`,
      [
        input.id ?? null,
        input.estate_id,
        input.unit,
        input.deal_type,
        input.price,
        input.saleable_area,
        input.saleable_psf,
        input.deal_date,
        input.block,
        input.floor_band,
        input.source,
        input.source_url,
        input.agent_id,
        input.social_copy_fb ?? null,
        input.social_copy_ig ?? null,
      ],
    );
    const id = stringOrEmpty(rows[0]?.id);
    await writeAudit(
      actor.staffId,
      !input.id
        ? "transaction.create"
        : resetToPending
          ? "transaction.correct"
          : "transaction.update",
      "transaction",
      id,
    );
    return { id };
  }

  async function verifyAdminTransaction(id: string, actor: StaffAccess) {
    await queryRows(
      "UPDATE transactions SET verification_state = 'verified', verified_at = now() WHERE id = $1",
      [id],
    );
    await writeAudit(actor.staffId, "transaction.verify", "transaction", id);
    return { ok: true as const };
  }

  async function publishAdminTransaction(id: string, actor: StaffAccess) {
    const rows = await queryRows("SELECT verification_state FROM transactions WHERE id = $1", [id]);
    if (rows[0]?.verification_state !== "verified") {
      return { ok: false as const, code: "TRANSACTION_NOT_VERIFIED" as const };
    }
    await queryRows("UPDATE transactions SET published = true WHERE id = $1", [id]);
    await writeAudit(actor.staffId, "transaction.publish", "transaction", id);
    return { ok: true as const };
  }

  async function unpublishAdminTransaction(id: string, actor: StaffAccess) {
    await queryRows("UPDATE transactions SET published = false WHERE id = $1", [id]);
    await writeAudit(actor.staffId, "transaction.unpublish", "transaction", id);
    return { ok: true as const };
  }

  async function importAdminTransactionsDraft(
    rows: AdminTransactionInput[],
    actor: StaffAccess,
  ): Promise<AdminTransactionImportResult> {
    let imported = 0;
    let failure: AdminTransactionImportResult["failure"] = null;
    for (const [index, row] of rows.entries()) {
      try {
        await saveAdminTransaction({ ...row, id: undefined }, actor);
        imported += 1;
      } catch (err) {
        failure = { position: index + 1, message: err instanceof Error ? err.message : "未知錯誤" };
        break;
      }
    }
    return { imported, total: rows.length, failure };
  }

  return {
    listAdminTransactions,
    getAdminTransaction,
    saveAdminTransaction,
    verifyAdminTransaction,
    publishAdminTransaction,
    unpublishAdminTransaction,
    importAdminTransactionsDraft,
  };
}

const defaultService = createAdminTransactionsService();

export const listAdminTransactions = defaultService.listAdminTransactions;
export const getAdminTransaction = defaultService.getAdminTransaction;
export const saveAdminTransaction = defaultService.saveAdminTransaction;
export const verifyAdminTransaction = defaultService.verifyAdminTransaction;
export const publishAdminTransaction = defaultService.publishAdminTransaction;
export const unpublishAdminTransaction = defaultService.unpublishAdminTransaction;
export const importAdminTransactionsDraft = defaultService.importAdminTransactionsDraft;
