import test from "node:test";
import assert from "node:assert/strict";
import { readPublicSourceMetadata } from "./public-source-metadata.mjs";
const now = "2026-09-07T12:00:00Z";
const source = (name, phone, extra = {}) => ({
  source: "28hse_agent_540",
  observation_id: "o1",
  contact_observation_id: "o1",
  source_status: "active",
  last_accepted_at: now,
  contact: { name, phone },
  contact_approved: true,
  ...extra,
});
test("pre-migration reads remain compatible", async () => {
  let calls = 0;
  const result = await readPublicSourceMetadata(
    async () => {
      calls++;
      return [{ available: false }];
    },
    "p",
    { now },
  );
  assert.equal(calls, 1);
  assert.deepEqual(result, { source_contact: null, source_freshness: [] });
});
test("source contact stays distinct from staff profile and private raw identity", async () => {
  let calls = 0;
  const rows = [
    source("A", null),
    source("B", "12345678", { source: "propertyhk", raw_identity: { unit: "private" } }),
  ];
  const result = await readPublicSourceMetadata(
    async (statement, params) => {
      if (++calls === 1) return [{ available: true }];
      assert.deepEqual(params, ["p"]);
      return rows;
    },
    "p",
    { now },
  );
  assert.equal(result.source_contact.contact.name, "B");
  assert.equal(result.source_contact.contact.phone, "12345678");
  assert.equal("profiles" in result, false);
  assert.equal(JSON.stringify(result).includes("private"), false);
});
test("publication approval, freshness, inactivity and ambiguity gate contact transport", async () => {
  for (const rows of [
    [source("A", "12345678", { contact_approved: false })],
    [source("A", "12345678", { last_accepted_at: "2026-09-01T00:00:00Z" })],
    [source("A", "12345678", { source_status: "delisted" })],
    [source("A", "12345678"), source("Other", "87654321")],
  ]) {
    let calls = 0;
    const result = await readPublicSourceMetadata(
      async () => (++calls === 1 ? [{ available: true }] : rows),
      "p",
      { now },
    );
    assert.equal(result.source_contact, null);
  }
});

test("contact observation must equal current state and lookup spans public group", async () => {
  let calls = 0;
  const query = async (statement) => {
    if (++calls === 1) return [{ available: true }];
    assert.match(statement, /property_public_members/);
    assert.match(statement, /c\.observation_id = s\.observation_id/);
    return [source("Old contact", "12345678", { contact_observation_id: "old" })];
  };
  const result = await readPublicSourceMetadata(query, "representative", { now });
  assert.equal(result.source_contact, null);
});

test("held identity cannot publish a new contact through the preserved old relationship", async () => {
  let calls = 0;
  const result = await readPublicSourceMetadata(
    async () =>
      ++calls === 1
        ? [{ available: true }]
        : [
            source("Changed unit", "12345678", { projection_held: true }),
            source("Secondary", "87654321", { source: "propertyhk" }),
          ],
    "p",
    { now },
  );
  assert.equal(result.source_contact, null);
});
