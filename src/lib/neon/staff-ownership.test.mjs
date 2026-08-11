import assert from "node:assert/strict";
import test from "node:test";

import {
  STAFF_HISTORICAL_COLUMNS,
  STAFF_OWNERSHIP_COLUMNS,
  staffOwnershipCountSql,
  staffReassignStatements,
} from "./staff-ownership.ts";

test("ownership covers exactly the six current-assignment columns", () => {
  assert.deepEqual(
    STAFF_OWNERSHIP_COLUMNS.map((entry) => `${entry.table}.${entry.column}`).sort(),
    [
      "crm_contacts.assigned_agent_id",
      "crm_leads.assigned_agent_id",
      "inquiries.assigned_agent_id",
      "live_agent_sessions.assigned_agent_id",
      "properties.agent_id",
      "whatsapp_conversations.assigned_agent_id",
    ],
  );
});

test("reassignment touches every ownership column and no historical column", () => {
  const statements = staffReassignStatements("from-id", "to-id");
  assert.equal(statements.length, STAFF_OWNERSHIP_COLUMNS.length);

  for (const { table, column } of STAFF_OWNERSHIP_COLUMNS) {
    const match = statements.find((entry) => entry.statement.includes(`UPDATE ${table}`));
    assert.ok(match, `${table} must be reassigned`);
    assert.match(match.statement, new RegExp(`SET ${column} = \\$2`));
    assert.match(match.statement, new RegExp(`WHERE ${column} = \\$1`));
    assert.deepEqual(match.params, ["from-id", "to-id"]);
  }

  // Rewriting any of these would falsify who did something.
  const allSql = statements.map((entry) => entry.statement).join("\n");
  for (const historical of STAFF_HISTORICAL_COLUMNS) {
    assert.doesNotMatch(
      allSql,
      new RegExp(`SET ${historical}\\b`),
      `${historical} records history and must never be reassigned`,
    );
  }
});

test("historical columns and ownership columns do not overlap", () => {
  const owned = new Set(STAFF_OWNERSHIP_COLUMNS.map((entry) => entry.column));
  for (const historical of STAFF_HISTORICAL_COLUMNS) {
    assert.equal(owned.has(historical), false, `${historical} cannot be both`);
  }
  // Twelve distinct names across eighteen FK occurrences -- several tables
  // share a name such as `created_by`.
  assert.equal(STAFF_HISTORICAL_COLUMNS.length, 12);
});

test("count SQL returns one labelled count per ownership column", () => {
  const { statement, params } = staffOwnershipCountSql("staff-id");
  assert.deepEqual(params, ["staff-id"]);
  for (const { table } of STAFF_OWNERSHIP_COLUMNS) {
    assert.match(statement, new RegExp(`FROM ${table}`));
    assert.match(statement, new RegExp(`AS ${table}`));
  }
});
