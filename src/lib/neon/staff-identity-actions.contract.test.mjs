import assert from "node:assert/strict";
import test from "node:test";

import { createIdentityActionStore } from "./staff-identity-actions.server.ts";

function createStoreFixture() {
  const queries = [];
  const transactions = [];
  const store = createIdentityActionStore({
    queryRows: async (statement, params = []) => {
      queries.push({ statement, params });
      if (statement.includes("INSERT INTO staff_identity_actions")) {
        return [{ id: "operation-1", state: "pending", inserted: false }];
      }
      if (statement.includes("FROM staff_identity_actions")) {
        return [
          {
            state: "succeeded",
            retry_after: "2026-08-16T01:00:00.000Z",
            provider_expires_at: "2026-08-17T01:00:00.000Z",
          },
        ];
      }
      return [];
    },
    transactionRows: async (statements) => {
      transactions.push(statements);
      return [];
    },
  });
  return { store, queries, transactions };
}

test("beginIdentityAction normalizes email and reports a conflicting key as an existing operation", async () => {
  const { store, queries } = createStoreFixture();
  const result = await store.beginIdentityAction({
    idempotencyKey: "invite:request-1",
    action: "invite",
    actorStaffId: "actor-1",
    targetStaffId: "target-1",
    targetEmail: "  New.User@Example.TEST ",
    requestId: "11111111-1111-4111-8111-111111111111",
  });

  assert.deepEqual(result, { operationId: "operation-1", isExisting: true, state: "pending" });
  assert.equal(queries.length, 1);
  assert.match(queries[0].statement, /ON CONFLICT \(idempotency_key\) DO UPDATE/);
  assert.match(queries[0].statement, /updated_at = staff_identity_actions\.updated_at/);
  assert.equal(queries[0].params[4], "new.user@example.test");
});

test("identity-action state transitions only persist safe fields", async () => {
  const { store, transactions } = createStoreFixture();
  await store.markIdentityActionSucceeded({
    operationId: "operation-1",
    providerExpiresAt: "2026-08-17T09:00:00+08:00",
  });
  await store.markIdentityActionRetryable({
    operationId: "operation-1",
    safeErrorCode: "PROVIDER_UNAVAILABLE",
    retryAfter: "2026-08-16T02:00:00.000Z",
  });
  await store.markIdentityActionTerminal({
    operationId: "operation-1",
    safeErrorCode: "PROVIDER_FORBIDDEN",
  });

  assert.equal(transactions.length, 3);
  assert.match(transactions[0][0].statement, /state = 'succeeded'/);
  assert.match(transactions[0][0].statement, /state IN \('pending', 'retryable_failure'\)/);
  assert.equal(transactions[0][0].params[1], "2026-08-17T01:00:00.000Z");
  assert.match(transactions[1][0].statement, /state = 'retryable_failure'/);
  assert.match(transactions[2][0].statement, /state = 'terminal_failure'/);
  for (const transaction of transactions) {
    assert.doesNotMatch(
      transaction[0].statement,
      /\b(?:password|token|secret|cookie|raw_response|email_body)\b/i,
    );
  }
});

test("findIdentityActionCooldown returns only state and safe timestamps", async () => {
  const { store, queries } = createStoreFixture();
  const cooldown = await store.findIdentityActionCooldown({
    targetStaffId: "target-1",
    action: "resend_invitation",
    now: "2026-08-16T00:00:00.000Z",
  });

  assert.deepEqual(cooldown, {
    state: "succeeded",
    retryAfter: "2026-08-16T01:00:00.000Z",
    providerExpiresAt: "2026-08-17T01:00:00.000Z",
  });
  assert.match(queries[0].statement, /SELECT state, retry_after, provider_expires_at/);
  assert.doesNotMatch(queries[0].statement, /SELECT \*/);
});
