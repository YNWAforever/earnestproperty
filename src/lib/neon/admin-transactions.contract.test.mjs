import assert from "node:assert/strict";
import test from "node:test";

import { createAdminTransactionsService } from "./admin-transactions.server.ts";

const actor = { staffId: "11111111-1111-4111-8111-111111111111", roles: ["admin"] };

const validInput = {
  estate_id: "33333333-3333-4333-8333-333333333333",
  unit: null,
  deal_type: "sale",
  price: 6_000_000,
  saleable_area: 617,
  saleable_psf: 9724,
  deal_date: "2026-07-22",
  block: null,
  floor_band: null,
  source: null,
  source_url: null,
  agent_id: null,
};

function fixture(overrides = {}) {
  const queries = [];
  const audits = [];
  const service = createAdminTransactionsService({
    queryRows: async (statement, params = []) => {
      queries.push({ statement, params });
      if (overrides.queryRows) return overrides.queryRows(statement, params);
      if (statement.includes("SELECT * FROM transactions WHERE id")) {
        return [{ ...validInput, verification_state: "unverified" }];
      }
      return [{ id: "22222222-2222-4222-8222-222222222222" }];
    },
    writeAudit: async (...args) => {
      audits.push(args);
    },
  });
  return { service, queries, audits };
}

/** A fixture whose id lookup reports the row as already verified, with the
 * given factual field(s) overridden -- used to test the demotion rule. */
function verifiedFixture(storedOverrides = {}) {
  return fixture({
    queryRows: async (statement) => {
      if (statement.includes("SELECT * FROM transactions WHERE id")) {
        return [{ ...validInput, verification_state: "verified", ...storedOverrides }];
      }
      return [{ id: "44444444-4444-4444-8444-444444444444" }];
    },
  });
}

test("saveAdminTransaction rejects a PSF more than 5% off price/area", async () => {
  const { service } = fixture();
  await assert.rejects(
    () => service.saveAdminTransaction({ ...validInput, saleable_psf: 5_000 }, actor),
    /實呎.*不符|PSF/,
  );
});

test("saveAdminTransaction accepts a PSF within 5% of price/area", async () => {
  const { service } = fixture();
  const result = await service.saveAdminTransaction(validInput, actor);
  assert.equal(result.id, "22222222-2222-4222-8222-222222222222");
});

test("saveAdminTransaction rejects a future deal_date", async () => {
  const { service } = fixture();
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await assert.rejects(
    () => service.saveAdminTransaction({ ...validInput, deal_date: future }, actor),
    /日期|date/,
  );
});

test("saveAdminTransaction rejects non-positive price or area", async () => {
  const { service } = fixture();
  await assert.rejects(() => service.saveAdminTransaction({ ...validInput, price: 0 }, actor));
  await assert.rejects(() =>
    service.saveAdminTransaction({ ...validInput, saleable_area: -1 }, actor),
  );
});

test("saveAdminTransaction requires an estate_id", async () => {
  const { service } = fixture();
  await assert.rejects(() => service.saveAdminTransaction({ ...validInput, estate_id: "" }, actor));
});

test("changing a factual field on an already-verified transaction resets it to pending and clears verified_at", async () => {
  const { service, queries } = verifiedFixture();
  await service.saveAdminTransaction(
    {
      ...validInput,
      id: "44444444-4444-4444-8444-444444444444",
      price: 6_500_000,
      saleable_psf: 10_534,
    },
    actor,
  );
  const insertQuery = queries.find((q) => q.statement.includes("INSERT INTO transactions"));
  assert.match(insertQuery.statement, /'pending'/);
  assert.match(insertQuery.statement, /verified_at = NULL/);
});

test("saving only social copy on an already-verified transaction does NOT demote it to pending", async () => {
  const { service, queries } = verifiedFixture();
  await service.saveAdminTransaction(
    {
      ...validInput,
      id: "44444444-4444-4444-8444-444444444444",
      social_copy_fb: "新增嘅 FB 文案",
      social_copy_ig: null,
    },
    actor,
  );
  const insertQuery = queries.find((q) => q.statement.includes("INSERT INTO transactions"));
  assert.doesNotMatch(insertQuery.statement, /'pending'/);
});

test("re-saving an already-verified transaction with identical facts does NOT demote it", async () => {
  const { service, queries } = verifiedFixture();
  await service.saveAdminTransaction(
    { ...validInput, id: "44444444-4444-4444-8444-444444444444" },
    actor,
  );
  const insertQuery = queries.find((q) => q.statement.includes("INSERT INTO transactions"));
  assert.doesNotMatch(insertQuery.statement, /'pending'/);
});

test("saveAdminTransaction writes transaction.create for a new row, transaction.correct when demoting from verified", async () => {
  const { service, audits } = fixture();
  await service.saveAdminTransaction(validInput, actor);
  assert.equal(audits[0][1], "transaction.create");

  const { service: correctService, audits: correctAudits } = verifiedFixture();
  await correctService.saveAdminTransaction(
    {
      ...validInput,
      id: "44444444-4444-4444-8444-444444444444",
      price: 6_500_000,
      saleable_psf: 10_534,
    },
    actor,
  );
  assert.equal(correctAudits[0][1], "transaction.correct");
});

test("publishAdminTransaction refuses to publish an unverified transaction", async () => {
  const { service } = fixture({
    queryRows: async (statement) => {
      if (statement.includes("SELECT verification_state"))
        return [{ verification_state: "pending" }];
      return [];
    },
  });
  const result = await service.publishAdminTransaction("id", actor);
  assert.deepEqual(result, { ok: false, code: "TRANSACTION_NOT_VERIFIED" });
});

test("publishAdminTransaction publishes a verified transaction", async () => {
  const { service } = fixture({
    queryRows: async (statement) => {
      if (statement.includes("SELECT verification_state"))
        return [{ verification_state: "verified" }];
      return [];
    },
  });
  const result = await service.publishAdminTransaction("id", actor);
  assert.deepEqual(result, { ok: true });
});

test("verifyAdminTransaction sets verification_state and writes an audit event", async () => {
  const { service, queries, audits } = fixture();
  await service.verifyAdminTransaction("id", actor);
  const updateQuery = queries.find((q) =>
    q.statement.includes("UPDATE transactions SET verification_state"),
  );
  assert.match(updateQuery.statement, /'verified'/);
  assert.equal(audits[0][1], "transaction.verify");
});

test("importAdminTransactionsDraft stops at the first failure and reports its position", async () => {
  const { service } = fixture();
  const rows = [validInput, { ...validInput, price: 0 }, validInput];
  const result = await service.importAdminTransactionsDraft(rows, actor);
  assert.equal(result.imported, 1);
  assert.equal(result.total, 3);
  assert.equal(result.failure.position, 2);
});
