export type StaffNotificationStatus =
  | "pending"
  | "acknowledged"
  | "resolved"
  | "superseded"
  | "cancelled";
export type StaffNotificationItem = {
  id: string;
  inquiryId: string;
  conversationId: string;
  assignmentVersion: number;
  purpose: string;
  workState: StaffNotificationStatus;
  requestedStaffId: string | null;
  requestedName: string | null;
  handlerStaffId: string;
  handlerName: string | null;
  mismatchReason: string | null;
  publicListingNo: string | null;
  dealType: string | null;
  source: string | null;
  responseDueAt: string | null;
  firstHumanResponseAt: string | null;
  acknowledgedAt: string | null;
  helpRequestedAt: string | null;
  createdAt: string;
  canAct: boolean;
  attempts: {
    transport: string;
    state: string;
    evidenceKind: string | null;
    error: string | null;
    acceptedAt: string | null;
    acceptedSource: string | null;
    deliveredAt: string | null;
    deliveredSource: string | null;
    readAt: string | null;
    readSource: string | null;
  }[];
};
export type StaffNotificationPage = {
  available: boolean;
  items: StaffNotificationItem[];
  nextCursor: string | null;
};
