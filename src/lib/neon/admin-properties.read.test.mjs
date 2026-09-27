import assert from "node:assert/strict";
import test from "node:test";
import { buildAdminPropertyGroupsQuery, mapAdminPropertyGroup } from "./admin-properties.server.ts";
test("unlinked identities remain visible and cannot advertise unsupported edits", () => {
  const { summary } = mapAdminPropertyGroup({
    group_no: "unlinked:id",
    unlinked: true,
    editable_shared: true,
    version: "v",
    offerings: [{ id: "id", deal_type: "sale", status: "active", title_zh: "Manual", images: [] }],
  });
  assert.equal(summary.editableShared, false);
  assert.equal(summary.offerings.sale.editable, false);
});

test("public management filter keeps active linked groups while all retains diagnostics", () => {
  const actor = { staffId: "10000000-0000-0000-0000-000000000001", roles: ["admin"] };
  const publicQuery = buildAdminPropertyGroupsQuery(
    { status: "active", publication: "public" },
    actor,
  );
  const allQuery = buildAdminPropertyGroupsQuery({ status: "active" }, actor);
  assert.match(publicQuery.statement, /p\.status::text=\$2/);
  assert.match(publicQuery.statement, /NOT p\.unlinked/);
  assert.doesNotMatch(allQuery.statement, /NOT p\.unlinked/);
});
