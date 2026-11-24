/**
 * Lead-scope classification and assignment (Willy's three-case rule, 2026-11-24).
 *
 *   定單位      (a specific listing/unit) -> that unit's 負責 Sales
 *   只講屋苑    (estate named, no unit)   -> that estate's 經理
 *   無範圍      (nothing usable)          -> nobody; the copy recipient only
 *
 * Kept as pure logic next to `lead-default-assignee.js` so the intake SQL and the
 * tests share one decision, and so the unscoped case can never quietly fall back
 * to the default assignee: "copy only" means `assigned_agent_id` stays NULL.
 */
export const ENQUIRY_SCOPE = Object.freeze({
  UNIT: "unit",
  ESTATE: "estate",
  UNKNOWN: "unknown",
});

/**
 * Which of the three cases an enquiry is. A listing reference wins over an
 * estate reference: a buyer who named a unit asked about that unit, even if the
 * form also carried the estate it belongs to.
 */
export function classifyEnquiryScope({
  propertyId = null,
  listingNo = null,
  estateSlug = null,
} = {}) {
  if (propertyId || listingNo) return ENQUIRY_SCOPE.UNIT;
  if (estateSlug) return ENQUIRY_SCOPE.ESTATE;
  return ENQUIRY_SCOPE.UNKNOWN;
}

/**
 * The owner for one enquiry, in the order the intake statement applies.
 *
 * - unit:   visitor's pick > the 負責經紀 from property_agents > the listing's own
 *           active agent > the configured default assignee
 * - estate: that estate's manager from the rotation sheet > the configured default
 *           assignee (an estate the sheet does not cover still needs an owner)
 * - unknown: nobody. Willy's rule is explicit that "無範圍" gets the copy only, so
 *           the default assignee must not be used here.
 */
export function resolveLeadAssignment({
  scope = ENQUIRY_SCOPE.UNKNOWN,
  chosenAgentId = null,
  correspondentAgentId = null,
  listingAgentId = null,
  listingAgentActive = false,
  estateManagerStaffId = null,
  defaultAssigneeId = null,
} = {}) {
  if (scope === ENQUIRY_SCOPE.UNIT) {
    if (chosenAgentId) return chosenAgentId;
    if (correspondentAgentId) return correspondentAgentId;
    if (listingAgentActive && listingAgentId) return listingAgentId;
    return defaultAssigneeId ?? null;
  }
  if (scope === ENQUIRY_SCOPE.ESTATE) {
    return estateManagerStaffId ?? defaultAssigneeId ?? null;
  }
  return null;
}

/**
 * The single fallback the intake SQL needs for a given scope: the estate manager
 * for an estate enquiry, the default assignee for a unit enquiry, and nothing at
 * all for an unscoped one (which is how "copy only" is expressed in the
 * statement rather than by a second code path).
 */
export function scopeFallbackAssigneeId({
  scope = ENQUIRY_SCOPE.UNKNOWN,
  estateManagerStaffId = null,
  defaultAssigneeId = null,
} = {}) {
  if (scope === ENQUIRY_SCOPE.ESTATE) return estateManagerStaffId ?? defaultAssigneeId ?? null;
  if (scope === ENQUIRY_SCOPE.UNIT) return defaultAssigneeId ?? null;
  return null;
}
