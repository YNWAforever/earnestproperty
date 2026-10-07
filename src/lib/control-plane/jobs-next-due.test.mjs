import assert from "node:assert/strict";
import test from "node:test";

import { getNextJobDueAt } from "./jobs-next-due.ts";

test("the next alarm follows queued run_after and running lease expiry in the selected lane", async () => {
  const calls = [];
  const due = await getNextJobDueAt({
    lane: "service",
    capabilities: ["woztell.enquiry.service@1"],
    query: async (sql, params) => {
      calls.push({ sql, params });
      return [{ due_at: new Date("2026-09-25T12:03:00.000Z") }];
    },
  });
  assert.equal(due, "2026-09-25T12:03:00.000Z");
  assert.deepEqual(calls[0].params, ["service", ["woztell.enquiry.service@1"]]);
  assert.match(calls[0].sql, /status='queued' THEN run_after ELSE lease_expires_at/);
  assert.match(calls[0].sql, /job_type \|\| '@' \|\| payload_version/);
});

test("a drained lane returns no due time and the general lane excludes service jobs", async () => {
  let statement = "";
  const due = await getNextJobDueAt({
    lane: "general",
    query: async (sql) => {
      statement = sql;
      return [{ due_at: null }];
    },
  });
  assert.equal(due, null);
  assert.match(statement, /woztell\.enquiry/);
  assert.match(statement, /woztell\.reply\.deliver/);
});

test("pending receipt yields nextDueAt", async () => {
  const { RECEIPT_DUE_AT_SQL } = await import("../whatsapp-enquiries/receipt-retry-policy.ts");
  let statement = "";
  const due = await getNextJobDueAt({
    lane: "service",
    capabilities: ["woztell.enquiry.service@1"],
    query: async (sql) => {
      statement = sql;
      return [{ due_at: "2026-09-25T12:05:00.000Z" }];
    },
  });
  assert.equal(due, "2026-09-25T12:05:00.000Z");
  assert.ok(statement.includes("whatsapp_inbound_receipts"));
  assert.ok(statement.includes(RECEIPT_DUE_AT_SQL("r")));
  assert.match(statement, /least\(/);
});

test("the general lane never reads receipts", async () => {
  let statement = "";
  await getNextJobDueAt({
    lane: "general",
    query: async (sql) => {
      statement = sql;
      return [{ due_at: null }];
    },
  });
  assert.ok(!statement.includes("whatsapp_inbound_receipts"));
  assert.doesNotMatch(statement, /least\(/);
});
