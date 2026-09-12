export type StaffReferenceMapping = {
  id: string;
  namespace: string;
  externalReference: string;
  staffId: string;
  version: number;
  validFrom: string;
  validUntil: string | null;
  verified: boolean;
};
export type StaffReferenceContext = {
  requestedStaffId?: string | null;
  propertyOwnerId?: string | null;
  namespace?: string | null;
  externalReference?: string | null;
};
export function resolveStaffReference(
  context: StaffReferenceContext,
  mappings: StaffReferenceMapping[],
  at: string,
) {
  const instant = Date.parse(at);
  if (!Number.isFinite(instant))
    return {
      status: "review" as const,
      staffId: null,
      reason: "reference_time_invalid",
      mapping: null,
    };
  const hasAlias = !!(context.namespace || context.externalReference);
  const matches = hasAlias
    ? mappings.filter(
        (m) =>
          m.verified &&
          m.namespace === context.namespace &&
          m.externalReference === context.externalReference &&
          Date.parse(m.validFrom) <= instant &&
          (!m.validUntil || instant < Date.parse(m.validUntil)),
      )
    : [];
  if (hasAlias && matches.length !== 1)
    return {
      status: "review" as const,
      staffId: null,
      reason: "reference_unresolved",
      mapping: null,
    };
  const mapping = matches[0] ?? null;
  if (mapping && context.requestedStaffId && mapping.staffId !== context.requestedStaffId)
    return {
      status: "review" as const,
      staffId: null,
      reason: "reference_conflict",
      mapping: null,
    };
  const staffId = context.requestedStaffId ?? mapping?.staffId ?? null;
  return {
    status: staffId ? ("resolved" as const) : ("review" as const),
    staffId,
    reason: staffId ? null : "reference_unresolved",
    mapping,
  };
}
/** Explicit customer edits are hints for review; never authority for recipients or nodes. */
export function hasUntrustedStaffOverride(text: string) {
  return /(?:staff_ref|requested_staff_id|endpoint_id|routing_node_id)\s*[:=]/i.test(text);
}
