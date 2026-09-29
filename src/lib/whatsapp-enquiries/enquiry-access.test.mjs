import assert from "node:assert/strict";
import test from "node:test";
import { decideEnquiryAccess } from "./enquiry-access.server.ts";

const S1 = "S1",
  S2 = "S2",
  M1 = "M1";
const base = {
  actorId: S1,
  roles: ["agent"],
  active: true,
  actorBranchId: "A",
  enquiryOwnerId: null,
  conversationAssigneeId: S1,
  providerConfirmedId: S1,
  responsibleBranchId: "A",
  providerThreadReview: false,
};

test("active admin sees all; manager only own branch; viewer and inactive fail closed", () => {
  assert.equal(decideEnquiryAccess({ ...base, actorId: "A", roles: ["admin"] }).canRead, true);
  assert.equal(
    decideEnquiryAccess({ ...base, actorId: M1, roles: ["manager"], actorBranchId: "A" })
      .canCorrect,
    true,
  );
  assert.equal(
    decideEnquiryAccess({ ...base, actorId: M1, roles: ["manager"], actorBranchId: "B" }).canRead,
    false,
  );
  assert.equal(
    decideEnquiryAccess({ ...base, actorId: M1, roles: ["manager"], actorBranchId: null }).canRead,
    false,
  );
  assert.equal(decideEnquiryAccess({ ...base, roles: ["viewer"] }).canRead, false);
  assert.equal(decideEnquiryAccess({ ...base, active: false }).canRead, false);
});

test("new S2 enquiry preserves S1 relationship and denies S2 unrelated history or direct reply", () => {
  const context = { ...base, enquiryOwnerId: S2, providerThreadReview: true };
  const s2 = decideEnquiryAccess({ ...context, actorId: S2 });
  assert.equal(s2.canRead, true);
  assert.equal(s2.historyScope, "enquiry");
  assert.equal(s2.canReply, false);
  assert.equal(s2.canExport, false);
  const s1 = decideEnquiryAccess(context);
  assert.equal(s1.canRead, true);
  assert.equal(s1.canReply, false);
  assert.equal(s1.historyScope, "conversation");
  assert.equal(decideEnquiryAccess({ ...context, actorId: "other" }).canRead, false);
});

test("provider confirmation alone does not override enquiry ownership review", () => {
  const pending = decideEnquiryAccess({ ...base, providerConfirmedId: null });
  assert.equal(pending.canReply, false);
  const direct = decideEnquiryAccess({ ...base, providerConfirmedId: S1 });
  assert.equal(direct.canReply, true);
});
