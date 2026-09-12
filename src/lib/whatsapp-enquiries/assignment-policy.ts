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
