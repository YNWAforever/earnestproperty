import { expect, test } from "bun:test";
import { assignableAgents, bulkAssignableAgents } from "./lead-assignment";
import type { AdminAgentRow } from "@/lib/neon/admin-data.types";

const agent = (id: string, active: boolean): AdminAgentRow => ({
  id,
  name: id,
  email: null,
  roles: ["agent"],
  active,
});
const A = agent("A", true);
const C = agent("C", false);
const D = agent("D", false);

test("detail picker lists active staff plus the inactive current owner, flagged", () => {
  expect(assignableAgents([A, C, D], "C")).toEqual([
    { agent: A, inactiveCurrent: false },
    { agent: C, inactiveCurrent: true },
  ]);
  expect(assignableAgents([A, C, D], "A")).toEqual([{ agent: A, inactiveCurrent: false }]);
  expect(assignableAgents([A, C, D], null)).toEqual([{ agent: A, inactiveCurrent: false }]);
});

test("bulk picker lists active staff only", () => {
  expect(bulkAssignableAgents([A, C, D])).toEqual([A]);
});
