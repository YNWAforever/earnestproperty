export const ENQUIRY_INFO_PURPOSE = "enq_forward_info" as const;
export type EnquiryInfoScope = { appId: string; channelId: string };
export type EnquiryInfoSubject =
  | { kind: "policy" }
  | { kind: "recipient_phone"; phone: string }
  | { kind: "sender_member"; memberId: string }
  | { kind: "receipt"; receiptId: string };
export type EnquiryInfoDecisionValue =
  | "armed"
  | "paused"
  | "revoked"
  | "approved"
  | "staff_bound"
  | "customer_confirmed"
  | "held"
  | "released_customer"
  | "released_staff";
export type EnquiryInfoDecision = {
  id: string;
  purpose: typeof ENQUIRY_INFO_PURPOSE;
  appId: string;
  channelId: string;
  subjectKind: EnquiryInfoSubject["kind"];
  subjectKey: string;
  revision: number;
  previousDecisionId: string | null;
  decision: EnquiryInfoDecisionValue;
  phone: string | null;
  staffId: string | null;
  memberId: string | null;
  receiptId: string | null;
  relatedDecisionId: string | null;
  profileHash: string | null;
  conflictHash: string | null;
  identitySnapshot: Record<string, unknown>;
  evidence: Record<string, unknown>;
  authorityKind: "owner_instruction" | "staff_session" | "system_policy";
  actorStaffId: string | null;
  createdAt: string;
};
export type EnquiryInfoPhoneSnapshot = {
  phone: string;
  profileHash: string;
  conflictHash: string;
  identitySnapshot: Record<string, unknown>;
  eligible: boolean;
  originalGuardAllows: boolean;
};
export type EnquiryInfoDecisionInput = {
  scope: EnquiryInfoScope;
  subject: EnquiryInfoSubject;
  decision: EnquiryInfoDecisionValue;
  expectedRevision: number;
  phone?: string;
  staffId?: string | null;
  relatedDecisionId?: string | null;
  expectedProfileHash?: string;
  expectedConflictHash?: string;
  evidence?: Record<string, unknown>;
  memberEvidence?: EnquiryInfoMemberEvidence;
};
export type EnquiryInfoOwnerInstruction = {
  goalId: string;
  sourceReference: string;
  sourceSha256: string;
  receivedAt: string;
  recorderReference: string;
  statement: string;
  questionId?: string;
  response?: string;
  photoSha256?: string;
};
export type EnquiryInfoMemberEvidence =
  | { kind: "provider_audit"; auditId: string; proofHash: string; receiptId?: string }
  | { kind: "accepted_ingress"; receiptId: string };
