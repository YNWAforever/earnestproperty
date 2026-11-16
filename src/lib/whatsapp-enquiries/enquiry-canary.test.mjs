import assert from "node:assert/strict";
import test from "node:test";
import { canarySendPlan, maskCanaryPhone } from "./enquiry-canary.js";

test("canary stays blocked unless the owner flag is exactly true", () => {
  const phone = "85298873493";
  for (const enabled of [undefined, "", "false", "TRUE", "1", " true"]) {
    assert.deepEqual(canarySendPlan({ EP_WA_CANARY_ENABLED: enabled, EP_WA_CANARY_PHONE: phone }), {
      allowed: false,
      reason: "CANARY_DISABLED",
    });
  }
  assert.deepEqual(canarySendPlan({}), { allowed: false, reason: "CANARY_DISABLED" });
});

test("canary refuses anything that is not a registered Hong Kong WhatsApp destination", () => {
  for (const candidate of [
    undefined,
    "",
    "9887",
    "12345678",
    "8529887349",
    "852988734931",
    "+1 415 555 0132",
    "not-a-phone",
  ]) {
    assert.deepEqual(
      canarySendPlan({ EP_WA_CANARY_ENABLED: "true", EP_WA_CANARY_PHONE: candidate }),
      { allowed: false, reason: "CANARY_PHONE_INVALID" },
    );
  }
});

test("canary accepts the owner number in its usual written forms only", () => {
  for (const written of ["9887 3493", "+852 9887 3493", "852-9887-3493", "85298873493"]) {
    assert.deepEqual(
      canarySendPlan({ EP_WA_CANARY_ENABLED: "true", EP_WA_CANARY_PHONE: written }),
      { allowed: true, phone: "85298873493" },
    );
  }
});

test("audit masking exposes only the country code and last four digits", () => {
  const masked = maskCanaryPhone("85298873493");
  assert.equal(masked, "852****3493");
  assert.equal(masked.includes("9887349"), false);
  assert.equal(maskCanaryPhone("nonsense"), "****");
  assert.equal(maskCanaryPhone(undefined), "****");
});
