// FX-17a G-11: the assignment context as it may leave the server. Staff ids, the request id,
// the proposal reason, the assignment lock and the provider evidence are diagnostics: they go
// under `diagnostics` for admins and are dropped for everyone else. The main view keeps names,
// booleans, the state and the enquiry ids the inbox acts on.
const text = (value) => (value === null || value === undefined ? null : String(value));

export function toAssignmentContextView(raw, { diagnostics }) {
  const rows = Array.isArray(raw.enquiries) ? raw.enquiries : [];
  return {
    proposedStaffName: text(raw.proposedStaffName),
    proposed: Boolean(raw.proposedStaffId),
    confirmedStaffName: text(raw.confirmed_staff_name),
    confirmed: Boolean(raw.confirmed_staff_id),
    desiredStaffName: text(raw.desired_staff_name),
    desired: Boolean(raw.desired_staff_id),
    assignmentState: text(raw.assignment_state),
    assignment_version: Number(raw.assignment_version),
    enquiries: rows.map((e) => ({
      id: String(e.id),
      property: text(e.property),
      source: text(e.source),
      requestedStaffName: text(e.requestedStaffName),
      requested: Boolean(e.requestedStaffId),
      dealType: text(e.dealType),
      firstResponseAt: text(e.firstResponseAt),
      dueAt: text(e.dueAt),
      review: e.review === true,
    })),
    diagnostics: diagnostics
      ? {
          proposalReason: String(raw.proposalReason ?? ""),
          proposedStaffId: text(raw.proposedStaffId),
          confirmedStaffId: text(raw.confirmed_staff_id),
          desiredStaffId: text(raw.desired_staff_id),
          assignedAgentId: text(raw.assigned_agent_id),
          requestId: text(raw.request_id),
          assignmentLock: raw.assignment_lock === true,
          evidence:
            raw.evidence && typeof raw.evidence === "object" && !Array.isArray(raw.evidence)
              ? { ...raw.evidence }
              : null,
          enquiries: rows.map((e) => ({
            id: String(e.id),
            requestedStaffId: text(e.requestedStaffId),
          })),
        }
      : null,
  };
}
