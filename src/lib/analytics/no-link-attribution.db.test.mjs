import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { SOURCE_EVIDENCE_SQL } from "./sales-performance.queries.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("source evidence is keyed to scoped enquiry IDs; message source does not gain click attribution", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE inquiries(id uuid PRIMARY KEY,placement_source text,source text,attribution_method text,link_open_id uuid);
   CREATE TABLE whatsapp_enquiry_reference_links(inquiry_id uuid,ref_index int,source text);`);
    await db.query(
      "INSERT INTO inquiries VALUES($1,'28hse','whatsapp','explicit_customer_statement',NULL),($2,NULL,'whatsapp','unknown',NULL),($3,'28hse','whatsapp','reference',$4)",
      [id(1), id(2), id(3), id(4)],
    );
    await db.query("INSERT INTO whatsapp_enquiry_reference_links VALUES($1,0,'28hse')", [id(1)]);
    const rows = (await db.query(SOURCE_EVIDENCE_SQL, [[id(1), id(2)]])).rows;
    assert.deepEqual(
      rows.map((r) => [r.inquiryId, r.sourceEvidence]),
      [
        [id(1), "message_28hse"],
        [id(2), "unknown"],
      ],
    );
    assert.equal(
      rows.some((r) => r.inquiryId === id(3)),
      false,
    );
    const click = (await db.query(SOURCE_EVIDENCE_SQL, [[id(3)]])).rows;
    assert.equal(click[0].sourceEvidence, "tracked_open");
  } finally {
    await db.close();
  }
});
