export type AssignmentContextDiagnostics = {
  proposalReason: string;
  proposedStaffId: string | null;
  confirmedStaffId: string | null;
  desiredStaffId: string | null;
  assignedAgentId: string | null;
  requestId: string | null;
  assignmentLock: boolean;
  evidence: Record<string, string | boolean> | null;
  enquiries: { id: string; requestedStaffId: string | null }[];
};
export type AssignmentContextView = {
  proposedStaffName: string | null;
  /** A proposal exists; its staff id is a diagnostic. */
  proposed: boolean;
  confirmedStaffName: string | null;
  confirmed: boolean;
  desiredStaffName: string | null;
  desired: boolean;
  assignmentState: string | null;
  assignment_version: number;
  enquiries: {
    id: string;
    property: string | null;
    source: string | null;
    requestedStaffName: string | null;
    requested: boolean;
    dealType: string | null;
    firstResponseAt: string | null;
    dueAt: string | null;
    review: boolean;
  }[];
  /** Admin only (`system.diagnostics.read`); null for every other role. */
  diagnostics: null | AssignmentContextDiagnostics;
};
export function toAssignmentContextView(
  raw: Record<string, unknown>,
  opts: { diagnostics: boolean },
): AssignmentContextView;
