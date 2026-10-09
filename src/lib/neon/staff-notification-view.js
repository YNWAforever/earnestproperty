// FX-17a G-11: a staff-notification item as it may leave the server. An allowlist: a field
// added to the server item later reaches no browser until it is named here.
// - Every role: the action ids (id, inquiryId, conversationId, assignmentVersion), names,
//   states and times. Colleague staff ids (requestedStaffId, handlerStaffId) are sent to no
//   one: no screen reads them.
// - Attempts keep transport, state and times; the evidence kind, the provider sources and the
//   error code are diagnostics, under `diagnostics` for admins and dropped for everyone else.
const ITEM_KEYS = [
  "id",
  "inquiryId",
  "conversationId",
  "assignmentVersion",
  "purpose",
  "workState",
  "requestedName",
  "handlerName",
  "mismatchReason",
  "publicListingNo",
  "dealType",
  "source",
  "responseDueAt",
  "firstHumanResponseAt",
  "acknowledgedAt",
  "helpRequestedAt",
  "createdAt",
  "canAct",
];
const DIAGNOSTIC_KEYS = [
  "evidenceKind",
  "error",
  "acceptedSource",
  "deliveredSource",
  "readSource",
];

export function toStaffNotificationView(item, { diagnostics }) {
  const attempts = Array.isArray(item.attempts) ? item.attempts : [];
  return {
    ...Object.fromEntries(ITEM_KEYS.map((key) => [key, item[key] ?? null])),
    attempts: attempts.map((a) => ({
      transport: a.transport,
      state: a.state,
      acceptedAt: a.acceptedAt ?? null,
      deliveredAt: a.deliveredAt ?? null,
      readAt: a.readAt ?? null,
    })),
    diagnostics: diagnostics
      ? {
          attempts: attempts.map((a) =>
            Object.fromEntries(DIAGNOSTIC_KEYS.map((key) => [key, a[key] ?? null])),
          ),
        }
      : null,
  };
}
