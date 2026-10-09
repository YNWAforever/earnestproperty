// FX-17a G-11: a staff-notification item as it may leave the server. Each attempt keeps its
// transport, state and times; the evidence kind, the provider sources and the error code are
// diagnostics, moved under `diagnostics` for admins and dropped for everyone else. The action
// ids (id, inquiryId, conversationId, assignmentVersion) stay for every role.
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
    ...item,
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
