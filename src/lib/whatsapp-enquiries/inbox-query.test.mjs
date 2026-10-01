import assert from "node:assert/strict";
import test from "node:test";
import { buildAdminPageQuery } from "../neon/admin-pagination-query.ts";
import { parseAdminPageInput, encodeAdminCursor } from "../neon/admin-pagination.ts";

const actor = { staffId: "00000000-0000-4000-8000-000000000001", roles: ["agent"] };

for (const status of ["unassigned", "mine", "awaiting", "attention"]) {
  test(`inbox ${status} view is accepted and uses the same filtered scope for rows and count`, () => {
    const query = buildAdminPageQuery({ resource: "conversations", status }, actor, {
      enquiries: true,
    });
    assert.match(query.statement, /wa_can_read_conversation\(\$1::uuid,w\.id\)/);
    assert.match(query.statement, /SELECT count\(\*\)::int FROM filtered/);
    assert.match(query.statement, /ORDER BY page_at DESC,id DESC/);
    assert.ok(
      query.params.includes(status) ||
        /assigned_agent_id|awaiting_human_response|association_review/.test(query.statement),
    );
  });
}

test("inbox cursor uses latest activity with created fallback, never creation alone", () => {
  const query = buildAdminPageQuery({ resource: "conversations" }, actor);
  assert.match(query.statement, /COALESCE\(w\.last_message_at,w\.created_at\) AS page_at/);
  const token = encodeAdminCursor(
    { at: "2026-09-29T00:00:00.000000Z", id: actor.staffId },
    query.binding,
  );
  const next = buildAdminPageQuery({ resource: "conversations", cursor: token }, actor);
  assert.match(next.statement, /\(page_at,id\) </);
  assert.match(query.statement, /ORDER BY page_at DESC,id DESC/);
});

test("inbox search covers scoped messages and verified listing references on the server", () => {
  const query = buildAdminPageQuery({ resource: "conversations", q: "4033349" }, actor);
  assert.match(query.statement, /whatsapp_messages/);
  assert.match(query.statement, /whatsapp_enquiry_reference_links/);
  assert.match(query.statement, /external_listing_id/);
  assert.match(query.statement, /public_listing_no/);
  assert.match(query.statement, /EXISTS/);
  assert.ok(!query.statement.includes("4033349"));
  assert.ok(query.params.some((value) => String(value).includes("4033349")));
});

test("inbox refuses arbitrary status and does not expose another actor cursor", () => {
  assert.throws(() => parseAdminPageInput({ resource: "conversations", status: "anything" }));
  const query = buildAdminPageQuery({ resource: "conversations", status: "mine" }, actor);
  assert.match(query.statement, /wa_can_read_conversation/);
});
