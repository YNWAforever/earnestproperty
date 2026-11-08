import { test, expect } from "bun:test";
import { reconcileMutationRequests, type MutationRow } from "./hosted-mutation-cleanup";
import { id } from "./hosted-test-fixture";
const cases = () => {
  const command = { id: id(1), requestId: id(2), action: "unpublish", payload: { title: "owned" } };
  const parent: MutationRow = {
    request_id: id(2),
    actor_id: id(3),
    operation: "unpublish",
    command,
    result: {},
    _transaction: "123",
  };
  const child: MutationRow = {
    request_id: id(4),
    actor_id: id(3),
    operation: "archive",
    command: {
      resourceId: id(1),
      revisionId: null,
      tokens: { requestId: id(4), expectedVersion: 2, editState: { resourceId: id(1) } },
    },
    result: { resource_id: id(1), created_by: id(3), state: "archived" },
    _transaction: "123",
  };
  const baseline: MutationRow = { ...parent, request_id: id(5), _transaction: "99" };
  return { parent, child, baseline, intents: [{ requestId: id(2), actorId: id(3), command }] };
};
test("exact transaction-owned unpublish child is removed with parent; full table equals baseline", () => {
  const { parent, child, baseline, intents } = cases(),
    after = [baseline, parent, child];
  const owned = reconcileMutationRequests([baseline], after, intents);
  expect(owned).toEqual([
    { requestId: parent.request_id, parentId: null },
    { requestId: child.request_id, parentId: parent.request_id },
  ]);
  const remaining = after.filter((row) => !owned.some((o) => o.requestId === row.request_id));
  expect(remaining).toEqual([baseline]);
  expect(reconcileMutationRequests([baseline], remaining, intents)).toEqual([]);
});
for (const [name, change, code] of [
  ["foreign actor", (r: MutationRow) => (r.actor_id = id(8)), "MUTATION_UNOWNED_CHILD"],
  ["different transaction", (r: MutationRow) => (r._transaction = "124"), "MUTATION_UNOWNED_CHILD"],
  [
    "different resource",
    (r: MutationRow) => (r.command.resourceId = id(8)),
    "MUTATION_UNOWNED_CHILD",
  ],
  ["wrong operation", (r: MutationRow) => (r.operation = "restore"), "MUTATION_CHILD_OPERATION"],
  ["wrong result", (r: MutationRow) => (r.result.resource_id = id(8)), "MUTATION_CHILD_RESOURCE"],
] as const)
  test(name + " is not authorized by broad actor/resource cleanup", () => {
    const { parent, child, intents } = cases();
    change(child);
    expect(() => reconcileMutationRequests([], [parent, child], intents)).toThrow(code);
  });
test("missing/duplicated children and overwritten baseline fail", () => {
  const { parent, child, baseline, intents } = cases();
  expect(() => reconcileMutationRequests([], [parent], intents)).toThrow(
    "MUTATION_CHILD_MISSING_OR_DUPLICATED",
  );
  const duplicate = structuredClone(child);
  duplicate.request_id = id(7);
  (duplicate.command.tokens as Record<string, unknown>).requestId = id(7);
  expect(() => reconcileMutationRequests([], [parent, child, duplicate], intents)).toThrow(
    "MUTATION_CHILD_MISSING_OR_DUPLICATED",
  );
  expect(() =>
    reconcileMutationRequests([baseline], [{ ...baseline, operation: "changed" }], intents),
  ).toThrow("MUTATION_BASELINE_CHANGED");
  expect(() => reconcileMutationRequests([baseline], [], intents)).toThrow(
    "MUTATION_BASELINE_CHANGED",
  );
});
