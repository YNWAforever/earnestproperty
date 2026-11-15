export const ENQUIRY_FORWARD_JOB: "woztell.enquiry.forward";
export const ENQUIRY_FORWARD_RECONCILE_JOB: "woztell.enquiry.forward.reconcile";
export const ENQUIRY_FORWARD_PURPOSE: "enquiry_forward";
export const ENQUIRY_COPY_PHONE: "85297987774";
export function forwardingPhone(value: unknown): string | null;
export function forwardingSubjectKey(source: string, subjectId: string): string;
export function uniqueForwardingRecipients<T extends { phone: string; kind: string }>(
  recipients: T[],
): T[];
export function forwardingSourceLabel(route: {
  source: string;
  propertyNo?: string | null;
  summary?: string | null;
}): string;
