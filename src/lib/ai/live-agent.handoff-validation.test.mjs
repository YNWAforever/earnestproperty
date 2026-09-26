import assert from "node:assert/strict";
import { mock, test } from "bun:test";

let queryCount = 0;
mock.module("@/lib/neon/db.server", () => ({
  getSql: () => {
    throw new Error("UNEXPECTED_DATABASE_ACCESS");
  },
  queryRows: async () => {
    queryCount += 1;
    throw new Error("UNEXPECTED_DATABASE_ACCESS");
  },
  numberOrNull: (value) => (value == null ? null : Number(value)),
  stringOrEmpty: (value) => (value == null ? "" : String(value)),
  stringOrNull: (value) => (value == null ? null : String(value)),
}));

const { LiveAgentPublicError, requestLiveAgentHandoff } = await import("./live-agent.server.ts");

const ownedSession = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  accessToken: "test-token",
};

test("handoff service rejects invalid budgets before session or CRM SQL", async () => {
  for (const budget of [
    { budget_min: -1, budget_max: 100 },
    { budget_min: 200, budget_max: 100 },
    { budget_min: 0, budget_max: -1 },
    { budget_min: Number.POSITIVE_INFINITY, budget_max: null },
  ]) {
    await assert.rejects(
      requestLiveAgentHandoff({ ...ownedSession, ...budget }),
      (error) => error instanceof LiveAgentPublicError && error.status === 400,
    );
  }
  assert.equal(queryCount, 0);
});

test("valid handoff budget proceeds to session lookup", async () => {
  queryCount = 0;
  await assert.rejects(
    requestLiveAgentHandoff({ ...ownedSession, budget_min: 0, budget_max: 100 }),
    /UNEXPECTED_DATABASE_ACCESS/,
  );
  assert.equal(queryCount, 1);
});
