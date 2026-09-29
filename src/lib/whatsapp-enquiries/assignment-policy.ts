export type AssignmentContext = {
  protected?: boolean;
  protectedStaffId?: string | null;
  coordinatorStaffId?: string | null;
  requestedStaffId?: string | null;
  offerOwnerId?: string | null;
  dutyStaffIds?: string[];
  receptionStaffId?: string | null;
};
export function selectAssignment(context: AssignmentContext, eligible: ReadonlySet<string>) {
  if (context.protected && !context.protectedStaffId)
    return { staffId: null, reason: "protected_owner_unavailable" };
  if (context.protectedStaffId)
    return eligible.has(context.protectedStaffId)
      ? { staffId: context.protectedStaffId, reason: "protected_owner" }
      : { staffId: null, reason: "protected_owner_unavailable" };
  const choices: [string | null | undefined, string][] = [
    [context.protectedStaffId, "protected_owner"],
    [context.coordinatorStaffId, "existing_coordinator"],
    [context.requestedStaffId, "requested_staff"],
    [context.offerOwnerId, "offer_owner"],
    ...(context.dutyStaffIds ?? []).map((id) => [id, "duty_pool"] as [string, string]),
    [context.receptionStaffId, "reception"],
  ];
  for (const [staffId, reason] of choices)
    if (staffId && eligible.has(staffId)) return { staffId, reason };
  return { staffId: null, reason: "routing_exception" };
}
export function classifyAssignmentExecution(result: {
  accepted: boolean;
  definitivelyRefused?: boolean;
}): "unknown" | "failed" {
  return !result.accepted && result.definitivelyRefused === true ? "failed" : "unknown";
}
export function selectResponseEnquiry(activeIds: readonly string[], explicitId?: string | null) {
  return explicitId
    ? activeIds.includes(explicitId)
      ? explicitId
      : null
    : activeIds.length === 1
      ? activeIds[0]
      : null;
}

/** No-link enquiry routing never moves a protected whole thread for one new listing. */
export function selectNoLinkAssignment(
  context: {
    associationReview: boolean;
    conversationAssigneeId?: string | null;
    requestedStaffId?: string | null;
    publicationOwnerId?: string | null;
    enquiryOwnerId?: string | null;
  },
  eligible: ReadonlySet<string>,
) {
  const current = context.conversationAssigneeId;
  const candidates = [
    context.requestedStaffId,
    context.publicationOwnerId,
    context.enquiryOwnerId,
  ].filter((id): id is string => !!id);
  if (current) {
    return eligible.has(current)
      ? {
          staffId: current,
          reason: candidates.some((id) => id !== current)
            ? "existing_coordinator_review"
            : "existing_coordinator",
        }
      : { staffId: null, reason: "protected_owner_unavailable" };
  }
  if (context.associationReview) return { staffId: null, reason: "no_link_review" };
  const distinct = [...new Set(candidates)];
  return distinct.length === 1 && eligible.has(distinct[0])
    ? { staffId: distinct[0], reason: "verified_no_link_owner" }
    : { staffId: null, reason: "routing_exception" };
}
