import assert from "node:assert/strict";
import test from "node:test";
import { mapAdminPropertyGroup } from "./admin-properties.server.ts";
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
