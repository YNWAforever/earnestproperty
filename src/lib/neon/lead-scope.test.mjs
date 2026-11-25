// Willy's three-case rule for a website enquiry (2026-11-24):
//   定單位 -> that unit's 負責 Sales, 只講屋苑 -> that estate's manager,
//   無範圍 -> nobody, the copy recipient only.
// The unscoped case is the one that must never quietly acquire an owner.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ENQUIRY_SCOPE,
  classifyEnquiryScope,
  resolveLeadAssignment,
  scopeFallbackAssigneeId,
} from "./lead-scope.js";

const CHOSEN = "3f9c1b0a-6d2e-4c8f-9a51-2b7d4e6f8a01";
const CORRESPONDENT = "9b1f7c3e-2a4d-4b6e-8c05-7d3e1f9a2b44";
const LISTING_AGENT = "11111111-1111-4111-8111-111111111111";
const ESTATE_MANAGER = "fb4dfa8f-a892-458b-a4f9-7caf48a4a0a2";
const DEFAULT_ASSIGNEE = "64d5a2d6-e602-4760-9709-63b0414f6a83";

test("a listing reference wins over an estate reference", () => {
  assert.equal(classifyEnquiryScope({}), ENQUIRY_SCOPE.UNKNOWN);
  assert.equal(classifyEnquiryScope(), ENQUIRY_SCOPE.UNKNOWN);
  assert.equal(classifyEnquiryScope({ estateSlug: "napa" }), ENQUIRY_SCOPE.ESTATE);
  assert.equal(classifyEnquiryScope({ listingNo: "A034926" }), ENQUIRY_SCOPE.UNIT);
  assert.equal(
    classifyEnquiryScope({ propertyId: "11111111-1111-4111-8111-111111111111" }),
    ENQUIRY_SCOPE.UNIT,
  );
  assert.equal(
    classifyEnquiryScope({ listingNo: "A034926", estateSlug: "napa" }),
    ENQUIRY_SCOPE.UNIT,
    "a buyer who named a unit asked about that unit",
  );
});

test("a unit enquiry keeps the full owner chain", () => {
  const base = { scope: ENQUIRY_SCOPE.UNIT, defaultAssigneeId: DEFAULT_ASSIGNEE };
  assert.equal(
    resolveLeadAssignment({ ...base, chosenAgentId: CHOSEN, correspondentAgentId: CORRESPONDENT }),
    CHOSEN,
  );
  assert.equal(
    resolveLeadAssignment({
      ...base,
      correspondentAgentId: CORRESPONDENT,
      listingAgentId: LISTING_AGENT,
      listingAgentActive: true,
    }),
    CORRESPONDENT,
  );
  assert.equal(
    resolveLeadAssignment({ ...base, listingAgentId: LISTING_AGENT, listingAgentActive: true }),
    LISTING_AGENT,
  );
  assert.equal(
    resolveLeadAssignment({ ...base, listingAgentId: LISTING_AGENT, listingAgentActive: false }),
    DEFAULT_ASSIGNEE,
  );
  assert.equal(
    resolveLeadAssignment({ ...base, estateManagerStaffId: ESTATE_MANAGER }),
    DEFAULT_ASSIGNEE,
    "the estate manager never owns a unit enquiry",
  );
});

test("an estate enquiry goes to that estate's manager", () => {
  const base = { scope: ENQUIRY_SCOPE.ESTATE, defaultAssigneeId: DEFAULT_ASSIGNEE };
  assert.equal(
    resolveLeadAssignment({ ...base, estateManagerStaffId: ESTATE_MANAGER }),
    ESTATE_MANAGER,
  );
  // An estate the sheet does not cover still needs an owner.
  assert.equal(resolveLeadAssignment({ ...base, estateManagerStaffId: null }), DEFAULT_ASSIGNEE);
  // A correspondent agent of some listing is irrelevant here.
  assert.equal(
    resolveLeadAssignment({
      ...base,
      estateManagerStaffId: ESTATE_MANAGER,
      correspondentAgentId: CORRESPONDENT,
    }),
    ESTATE_MANAGER,
  );
});

test("an unscoped enquiry has no owner, whatever else is configured", () => {
  const everything = {
    scope: ENQUIRY_SCOPE.UNKNOWN,
    chosenAgentId: CHOSEN,
    correspondentAgentId: CORRESPONDENT,
    listingAgentId: LISTING_AGENT,
    listingAgentActive: true,
    estateManagerStaffId: ESTATE_MANAGER,
    defaultAssigneeId: DEFAULT_ASSIGNEE,
  };
  assert.equal(resolveLeadAssignment(everything), null);
  assert.equal(resolveLeadAssignment(), null);
  assert.equal(scopeFallbackAssigneeId(everything), null);
});

test("the SQL fallback column follows the same three cases", () => {
  assert.equal(
    scopeFallbackAssigneeId({ scope: ENQUIRY_SCOPE.UNIT, defaultAssigneeId: DEFAULT_ASSIGNEE }),
    DEFAULT_ASSIGNEE,
  );
  assert.equal(
    scopeFallbackAssigneeId({
      scope: ENQUIRY_SCOPE.ESTATE,
      estateManagerStaffId: ESTATE_MANAGER,
      defaultAssigneeId: DEFAULT_ASSIGNEE,
    }),
    ESTATE_MANAGER,
  );
  assert.equal(
    scopeFallbackAssigneeId({
      scope: ENQUIRY_SCOPE.ESTATE,
      estateManagerStaffId: null,
      defaultAssigneeId: DEFAULT_ASSIGNEE,
    }),
    DEFAULT_ASSIGNEE,
  );
  assert.equal(
    scopeFallbackAssigneeId({ scope: ENQUIRY_SCOPE.UNKNOWN, defaultAssigneeId: DEFAULT_ASSIGNEE }),
    null,
  );
});
