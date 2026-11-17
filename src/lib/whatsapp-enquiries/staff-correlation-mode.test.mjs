import assert from "node:assert/strict";
import test from "node:test";
import {
  STAFF_CORRELATION_MEMBER_ID,
  STAFF_CORRELATION_MODES,
  STAFF_CORRELATION_STRICT,
  staffCorrelationMode,
  staffCorrelationPlan,
} from "./staff-correlation-mode.js";

const ref = "audit:00000000-0000-4000-8000-000000000001";
const path = "data.context.replyTo";

test("strict is the default and needs both the reference and the reply-context path", () => {
  assert.deepEqual(STAFF_CORRELATION_MODES, [
    STAFF_CORRELATION_STRICT,
    STAFF_CORRELATION_MEMBER_ID,
  ]);
  assert.equal(staffCorrelationMode({}), STAFF_CORRELATION_STRICT);
  assert.equal(
    staffCorrelationMode({ EP_WA_STAFF_CORRELATION_MODE: "  " }),
    STAFF_CORRELATION_STRICT,
  );
  assert.equal(
    staffCorrelationMode({ EP_WA_STAFF_CORRELATION_MODE: "member-id" }),
    STAFF_CORRELATION_STRICT,
  );
  assert.equal(staffCorrelationPlan({}).ready, false);
  assert.equal(
    staffCorrelationPlan({ EP_WA_STAFF_CORRELATION_VERIFICATION_REF: ref }).ready,
    false,
  );
  assert.equal(staffCorrelationPlan({ EP_WA_STAFF_REPLY_CONTEXT_PATH: path }).ready, false);
  assert.equal(
    staffCorrelationPlan({
      EP_WA_STAFF_CORRELATION_VERIFICATION_REF: ref,
      EP_WA_STAFF_REPLY_CONTEXT_PATH: path,
    }).ready,
    true,
  );
});

test("member-id mode waives only the reply-context path", () => {
  const onlyPath = staffCorrelationPlan({
    EP_WA_STAFF_CORRELATION_MODE: "member_id",
    EP_WA_STAFF_REPLY_CONTEXT_PATH: path,
  });
  assert.equal(onlyPath.mode, STAFF_CORRELATION_MEMBER_ID);
  assert.equal(onlyPath.ready, false, "the reviewed evidence reference is still required");
  assert.equal(onlyPath.replyContextAvailable, false);

  const withRef = staffCorrelationPlan({
    EP_WA_STAFF_CORRELATION_MODE: "MEMBER_ID",
    EP_WA_STAFF_CORRELATION_VERIFICATION_REF: ref,
  });
  assert.equal(withRef.mode, STAFF_CORRELATION_MEMBER_ID);
  assert.equal(withRef.ready, true);
  assert.equal(withRef.requiresReplyContext, false);
  assert.equal(withRef.replyContextAvailable, false);
  assert.equal(withRef.replyContextPath, null);
});

test("both values are still used when the platform supplies them", () => {
  const plan = staffCorrelationPlan({
    EP_WA_STAFF_CORRELATION_MODE: "member_id",
    EP_WA_STAFF_CORRELATION_VERIFICATION_REF: ` ${ref} `,
    EP_WA_STAFF_REPLY_CONTEXT_PATH: ` ${path} `,
  });
  assert.equal(plan.verificationRef, ref);
  assert.equal(plan.replyContextPath, path);
  assert.equal(plan.replyContextAvailable, true);
  assert.equal(plan.ready, true);
});
