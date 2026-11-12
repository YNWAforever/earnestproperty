import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_AGENTS_PER_PROPERTY,
  contactsFromSourcePayload,
  normalizeStaffPhone,
  runAgentBackfill,
  selectStaffMatches,
} from "./backfill-old-site-agents.mjs";

const TOMMY = {
  id: "staff-tommy",
  name_zh: "姚頌溏",
  name_en: "Tommy Yiu",
  phone: "9123 4567",
  licence_no: "S-098767",
  active: true,
};
const KELVIN = {
  id: "staff-kelvin",
  name_zh: "李健",
  name_en: "Kelvin Lee",
  phone: "+852 6123 4567",
  licence_no: "E-226447",
  active: true,
};

test("normalizeStaffPhone keeps the 8 digits and strips HK prefixes", () => {
  assert.equal(normalizeStaffPhone("9123 4567"), "91234567");
  assert.equal(normalizeStaffPhone("+852 9123-4567"), "91234567");
  assert.equal(normalizeStaffPhone("85291234567"), "91234567");
  assert.equal(normalizeStaffPhone("00852-9123-4567"), "91234567");
  assert.equal(normalizeStaffPhone("(852) 2123 4567"), "21234567");
  assert.equal(normalizeStaffPhone("2123 4567"), "21234567");
  assert.equal(normalizeStaffPhone(""), null);
  assert.equal(normalizeStaffPhone(null), null);
  assert.equal(normalizeStaffPhone("9123456"), null);
  assert.equal(normalizeStaffPhone("tommy@example.com"), null);
});

test("contactsFromSourcePayload reads object and JSON-string payloads", () => {
  const contacts = { names: [" 姚頌溏 ", ""], phones: ["9123 4567", null] };
  assert.deepEqual(contactsFromSourcePayload({ contacts }), {
    contactNames: ["姚頌溏"],
    contactPhones: ["9123 4567"],
  });
  assert.deepEqual(contactsFromSourcePayload(JSON.stringify({ contacts })), {
    contactNames: ["姚頌溏"],
    contactPhones: ["9123 4567"],
  });
  assert.deepEqual(contactsFromSourcePayload(null), { contactNames: [], contactPhones: [] });
  assert.deepEqual(contactsFromSourcePayload("not json"), { contactNames: [], contactPhones: [] });
  assert.deepEqual(contactsFromSourcePayload({}), { contactNames: [], contactPhones: [] });
});

test("selectStaffMatches matches on phone before name", () => {
  const matches = selectStaffMatches(
    { contactNames: ["Kelvin Lee"], contactPhones: ["+852 9123 4567"] },
    [TOMMY, KELVIN],
  );
  assert.equal(matches.length, 2);
  assert.equal(matches[0].matchedBy, "phone");
  assert.equal(matches[0].staff.id, "staff-tommy");
  assert.equal(matches[0].rawPhone, "+852 9123 4567");
  assert.equal(matches[1].matchedBy, "name_en");
  assert.equal(matches[1].staff.id, "staff-kelvin");
  assert.equal(matches[1].rawName, "Kelvin Lee");
});

test("selectStaffMatches matches a Chinese full name contained in the contact text", () => {
  const matches = selectStaffMatches({ contactNames: ["姚頌溏先生"] }, [TOMMY, KELVIN]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].staff.id, "staff-tommy");
  assert.equal(matches[0].matchedBy, "name_zh");
});

test("selectStaffMatches matches an English name case-insensitively", () => {
  const matches = selectStaffMatches({ contactNames: ["kelvin lee"] }, [TOMMY, KELVIN]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].staff.id, "staff-kelvin");
  assert.equal(matches[0].matchedBy, "name_en");
});

test("selectStaffMatches matches staff aliases", () => {
  const staff = [{ ...TOMMY, aliases: ["湯美", "阿湯"] }];
  assert.equal(selectStaffMatches({ contactNames: ["湯美"] }, staff)[0].matchedBy, "alias");
  // A single English token still matches the name_en field itself.
  assert.equal(selectStaffMatches({ contactNames: ["tommy"] }, staff)[0].matchedBy, "name_en");
});

test("selectStaffMatches treats a name shared by two colleagues as ambiguous", () => {
  const staff = [
    { id: "a", name_zh: "陳大文", active: true },
    { id: "b", name_zh: "陳大文", active: true },
  ];
  assert.deepEqual(selectStaffMatches({ contactNames: ["陳大文"] }, staff), []);
});

test("selectStaffMatches dedupes a colleague matched by both phone and name", () => {
  const matches = selectStaffMatches({ contactNames: ["姚頌溏"], contactPhones: ["91234567"] }, [
    TOMMY,
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].matchedBy, "phone");
});

test("selectStaffMatches caps the result at two colleagues", () => {
  const staff = [1, 2, 3].map((index) => ({
    id: `staff-${index}`,
    name_zh: `同事${index}`,
    phone: `9123456${index}`,
    active: true,
  }));
  const matches = selectStaffMatches(
    { contactPhones: ["91234561", "91234562", "91234563"] },
    staff,
  );
  assert.equal(matches.length, MAX_AGENTS_PER_PROPERTY);
  assert.equal(matches.length, 2);
});

test("selectStaffMatches ignores emails, empty values and inactive staff", () => {
  const staff = [{ ...TOMMY, active: false }];
  assert.deepEqual(
    selectStaffMatches(
      { contactNames: ["", "tommy@example.com"], contactPhones: ["", "tommy@example.com"] },
      staff,
    ),
    [],
  );
  assert.deepEqual(selectStaffMatches({ contactNames: ["姚頌溏"] }, staff), []);
});

test("selectStaffMatches never picks a phone shared by two staff rows", () => {
  const staff = [
    { id: "a", phone: "91234567", name_zh: "甲", active: true },
    { id: "b", phone: "91234567", name_zh: "乙", active: true },
  ];
  assert.deepEqual(selectStaffMatches({ contactPhones: ["91234567"] }, staff), []);
});

const PROPERTY = {
  id: "11111111-1111-4111-8111-111111111111",
  listing_no: "B054805-6709182-S",
  canonical_property_no: "B054805",
  legacy_detail_id: "6709182",
  source_payload: {
    contacts: { names: ["姚頌溏"], phones: ["+852 9123 4567"] },
  },
};

function createFakeSql({ propertyRows = [], staffRows = [], existingRows = [], onInsert } = {}) {
  const queries = [];
  const inserts = [];
  const sql = async (strings, ...values) => {
    const text = String.raw(strings, ...values.map((_, index) => `$${index + 1}`));
    queries.push({ text, values });
    if (/INSERT INTO property_agents/.test(text)) {
      inserts.push({ text, values });
      if (onInsert) onInsert(values);
      return [];
    }
    if (/FROM staff_users/.test(text)) return staffRows;
    if (/FROM property_agents/.test(text)) return existingRows;
    if (/FROM properties p/.test(text)) return propertyRows;
    return [];
  };
  return { sql, queries, inserts };
}

test("runAgentBackfill dry-run reports matches without writing", async () => {
  const { sql, inserts } = createFakeSql({
    propertyRows: [PROPERTY],
    staffRows: [TOMMY, KELVIN],
  });
  const report = await runAgentBackfill({ sql, dryRun: true });

  assert.equal(inserts.length, 0);
  assert.equal(report.dryRun, true);
  assert.equal(report.candidates, 1);
  assert.equal(report.matched, 1);
  assert.equal(report.unmatched, 0);
  assert.equal(report.written, 1);
  assert.equal(report.rowsWritten, 1);
  assert.equal(report.skippedExisting, 0);
  assert.deepEqual(report.samples[0].agents, [
    { position: 1, staffId: "staff-tommy", staffName: "姚頌溏", matchedBy: "phone" },
  ]);
});

test("runAgentBackfill --apply upserts position 1-2 with the property_agents unique key", async () => {
  const { sql, inserts } = createFakeSql({
    propertyRows: [PROPERTY],
    staffRows: [TOMMY, KELVIN],
  });
  const report = await runAgentBackfill({ sql, dryRun: false });

  assert.equal(report.written, 1);
  assert.equal(inserts.length, 1);
  assert.match(inserts[0].text, /ON CONFLICT \(property_id, position\) DO UPDATE/);
  assert.equal(inserts[0].values[0], PROPERTY.id);
  assert.equal(inserts[0].values[1], 1);
  assert.equal(inserts[0].values[2], TOMMY.id);
  assert.equal(inserts[0].values[3], "earnestproperty-old-site");
  assert.equal(inserts[0].values[6], "6709182");
});

test("runAgentBackfill leaves a position that already has the same colleague", async () => {
  const existingRows = [{ property_id: PROPERTY.id, position: 1, staff_id: TOMMY.id }];
  const { sql, inserts } = createFakeSql({
    propertyRows: [PROPERTY],
    staffRows: [TOMMY],
    existingRows,
  });
  const report = await runAgentBackfill({ sql, dryRun: false });

  assert.equal(report.skippedExisting, 1);
  assert.equal(report.written, 0);
  assert.equal(inserts.length, 0);
});

test("runAgentBackfill only fills the positions that still differ", async () => {
  const twoContacts = {
    ...PROPERTY,
    source_payload: {
      contacts: { names: ["姚頌溏", "Kelvin Lee"], phones: ["+852 9123 4567"] },
    },
  };
  const existingRows = [{ property_id: PROPERTY.id, position: 1, staff_id: TOMMY.id }];
  const { sql, inserts } = createFakeSql({
    propertyRows: [twoContacts],
    staffRows: [TOMMY, KELVIN],
    existingRows,
  });
  await runAgentBackfill({ sql, dryRun: false });

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].values[1], 2);
  assert.equal(inserts[0].values[2], KELVIN.id);
});

test("runAgentBackfill reports properties whose contacts match nobody", async () => {
  const { sql, inserts } = createFakeSql({
    propertyRows: [PROPERTY],
    staffRows: [{ id: "other", name_zh: "無關同事", phone: "90000000", active: true }],
  });
  const report = await runAgentBackfill({ sql, dryRun: false });

  assert.equal(report.matched, 0);
  assert.equal(report.unmatched, 1);
  assert.equal(report.written, 0);
  assert.equal(report.unmatchedSamples.length, 1);
  assert.equal(report.unmatchedSamples[0].property, PROPERTY.listing_no);
  assert.equal(inserts.length, 0);
});

test("runAgentBackfill reports a failed upsert and keeps going", async () => {
  const { sql } = createFakeSql({
    propertyRows: [PROPERTY],
    staffRows: [TOMMY],
    onInsert: () => {
      throw new Error("constraint_violation");
    },
  });
  const report = await runAgentBackfill({ sql, dryRun: false });

  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0].message, /constraint_violation/);
});

test("runAgentBackfill respects the limit option", async () => {
  const second = { ...PROPERTY, id: "22222222-2222-4222-8222-222222222222", listing_no: "B1" };
  const { sql } = createFakeSql({ propertyRows: [PROPERTY, second], staffRows: [TOMMY] });
  const report = await runAgentBackfill({ sql, dryRun: true, limit: 1 });
  assert.equal(report.candidates, 2);
  assert.equal(report.processed, 1);
  assert.equal(report.matched, 1);
});

test("runAgentBackfill requires an injected sql function", async () => {
  await assert.rejects(() => runAgentBackfill({}), /tagged-template function/);
});
