import assert from "node:assert/strict";
import test from "node:test";
import {
  forwardingPhone,
  forwardingSubjectKey,
  uniqueForwardingRecipients,
  forwardingSourceLabel,
} from "./enquiry-forwarding-policy.mjs";

test("the fixed copy and the responsible Sales share one normalized destination", () => {
  const recipients = uniqueForwardingRecipients([
    { key: "sales:fixture", kind: "sales", phone: "+852 9798 7774" },
    { key: "copy", kind: "copy", phone: "97987774" },
    { key: "manager:1", kind: "manager", phone: "66442444" },
  ]);
  assert.deepEqual(
    recipients.map((r) => [r.key, r.phone]),
    [
      ["copy", "85297987774"],
      ["manager:1", "85266442444"],
    ],
  );
});

test("recipient normalization rejects malformed, foreign and placeholder destinations", () => {
  for (const value of [
    null,
    "",
    "85200000000",
    "85211111111",
    "8521234567",
    "6591234567",
    "85297987774x",
    "name@example.com",
  ])
    assert.equal(forwardingPhone(value), null);
  assert.equal(forwardingPhone("+852 (9100) 5322"), "85291005322");
});

test("deduplication does not merge different colleagues or invent an unavailable recipient", () => {
  assert.deepEqual(uniqueForwardingRecipients([{ kind: "sales", phone: "" }]), []);
  assert.equal(
    uniqueForwardingRecipients([
      { kind: "sales", phone: "66442444" },
      { kind: "copy", phone: "97987774" },
    ]).length,
    2,
  );
});

test("the work identity distinguishes website leads from WhatsApp enquiries", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  assert.notEqual(forwardingSubjectKey("website", id), forwardingSubjectKey("whatsapp", id));
  assert.throws(() => forwardingSubjectKey("history", id), /SUBJECT_INVALID/);
  assert.throws(() => forwardingSubjectKey("website", "untrusted"), /SUBJECT_INVALID/);
});

test("the approved source field carries the listing and a one-line enquiry summary", () => {
  assert.equal(
    forwardingSourceLabel({ source: "website", propertyNo: "C014574", summary: "想約睇\n星期六" }),
    "網站查詢 · C014574 · 想約睇 星期六",
  );
  assert.equal(forwardingSourceLabel({ source: "whatsapp", summary: null }), "WhatsApp 查詢");
});
