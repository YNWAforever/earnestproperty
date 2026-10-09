import type { StaffNotificationItem } from "./staff-notifications.types";

export type StaffNotificationAttemptDiagnostics = {
  evidenceKind: string | null;
  error: string | null;
  acceptedSource: string | null;
  deliveredSource: string | null;
  readSource: string | null;
};
export type StaffNotificationAttemptView = {
  transport: string;
  state: string;
  acceptedAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
};
export type StaffNotificationView = Omit<
  StaffNotificationItem,
  "attempts" | "requestedStaffId" | "handlerStaffId"
> & {
  attempts: StaffNotificationAttemptView[];
  /** Admin only (`system.diagnostics.read`); null for every other role. */
  diagnostics: null | { attempts: StaffNotificationAttemptDiagnostics[] };
};
/** Allowlisted view; colleague staff ids are never included. */
export function toStaffNotificationView(
  item: StaffNotificationItem,
  opts: { diagnostics: boolean },
): StaffNotificationView;
