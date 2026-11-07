import assert from "node:assert/strict";
import { digest } from "./hosted-contract";

export type MutationIntent = {
  requestId: string;
  actorId: string;
  command: Record<string, unknown>;
};
export type MutationRow = {
  request_id: string;
  actor_id: string;
  operation: string;
  command: Record<string, unknown>;
  result: Record<string, unknown>;
  _transaction: string;
  [key: string]: unknown;
};

/** A generated archive UUID is owned only through its exact unpublish parent in the same DB transaction.
 * Being written by an approved actor or touching an approved article alone is insufficient. */
export function reconcileMutationRequests(
  before: MutationRow[],
  after: MutationRow[],
  intents: MutationIntent[],
) {
  const baseline = new Map(before.map((r) => [r.request_id, r]));
  for (const [id, old] of baseline) {
    const current = after.find((r) => r.request_id === id);
    assert.ok(current, "MUTATION_BASELINE_CHANGED");
    assert.equal(digest(current), digest(old), "MUTATION_BASELINE_CHANGED");
  }
  const fresh = after.filter((r) => !baseline.has(r.request_id));
  assert.equal(new Set(after.map((r) => r.request_id)).size, after.length, "MUTATION_DUPLICATE_ID");
  const direct = new Map<string, MutationRow>();
  for (const row of fresh) {
    const intent = intents.find((i) => i.requestId === row.request_id);
    if (!intent) continue;
    assert.equal(row.actor_id, intent.actorId, "MUTATION_ACTOR_MISMATCH");
    assert.equal(row.operation, intent.command.action, "MUTATION_OPERATION_MISMATCH");
    assert.equal(digest(row.command), digest(intent.command), "MUTATION_COMMAND_MISMATCH");
    assert.match(row._transaction, /^[0-9]+$/, "MUTATION_TRANSACTION_MISSING");
    direct.set(row.request_id, row);
  }
  const childCounts = new Map<string, number>();
  const owned = fresh.map((row) => {
    if (direct.has(row.request_id)) return { requestId: row.request_id, parentId: null };
    const tokens = row.command.tokens as Record<string, unknown> | undefined;
    const parents = [...direct.values()].filter(
      (parent) =>
        parent.operation === "unpublish" &&
        parent.actor_id === row.actor_id &&
        parent._transaction === row._transaction &&
        parent.command.id === row.command.resourceId,
    );
    assert.equal(parents.length, 1, "MUTATION_UNOWNED_CHILD");
    const parent = parents[0];
    assert.equal(row.operation, "archive", "MUTATION_CHILD_OPERATION");
    assert.equal(row.command.revisionId, null, "MUTATION_CHILD_REVISION");
    assert.equal(tokens?.requestId, row.request_id, "MUTATION_CHILD_TOKEN");
    assert.ok(tokens?.editState && Number.isInteger(tokens?.expectedVersion), "MUTATION_CHILD_CAS");
    assert.equal(row.result.resource_id, parent.command.id, "MUTATION_CHILD_RESOURCE");
    assert.equal(row.result.created_by, row.actor_id, "MUTATION_CHILD_ACTOR");
    assert.equal(row.result.state, "archived", "MUTATION_CHILD_STATE");
    childCounts.set(parent.request_id, (childCounts.get(parent.request_id) ?? 0) + 1);
    return { requestId: row.request_id, parentId: parent.request_id };
  });
  for (const parent of direct.values())
    if (parent.operation === "unpublish")
      assert.equal(childCounts.get(parent.request_id), 1, "MUTATION_CHILD_MISSING_OR_DUPLICATED");
  return owned;
}
