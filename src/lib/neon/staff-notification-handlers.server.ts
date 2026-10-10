import "@tanstack/react-start/server-only";
import { requireStaffAccess } from "./auth.server.ts";
import { queryRows, transactionRows } from "./db.server.ts";
import {
  listMyStaffNotifications,
  acknowledgeStaffAssignment,
  requestStaffAssignmentHelp,
} from "./staff-notifications.server.ts";
import { toStaffNotificationView } from "./staff-notification-view.js";
import type { StaffNotificationViewPage } from "./staff-notifications.types";
import { canReadDiagnostics } from "../control-plane/permissions.ts";
const defaults = { requireStaffAccess, query: queryRows, transaction: transactionRows };
export async function handleStaffNotificationRequest<A extends "list" | "ack" | "help">(
  request: Request,
  action: A,
  data: unknown,
  deps = defaults,
) {
  if (request.method !== (action === "list" ? "GET" : "POST"))
    throw new Response("Method Not Allowed", { status: 405 });
  if (action !== "list") {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      throw new Response("Forbidden", { status: 403 });
  }
  const actor = await deps.requireStaffAccess(request, ["admin", "manager", "agent"]);
  return (
    action === "list"
      ? await listViews(data, actor, deps.query)
      : action === "ack"
        ? await acknowledgeStaffAssignment(data, actor, deps)
        : await requestStaffAssignmentHelp(data, actor, deps)
  ) as A extends "list"
    ? Awaited<ReturnType<typeof listViews>>
    : Awaited<ReturnType<typeof acknowledgeStaffAssignment>>;
}
// FX-17a G-11: provider evidence is stripped here, on the server, for every role but admin.
async function listViews(
  data: unknown,
  actor: Parameters<typeof listMyStaffNotifications>[1],
  query: typeof queryRows,
): Promise<StaffNotificationViewPage> {
  const page = await listMyStaffNotifications(data, actor, query);
  return {
    ...page,
    items: page.items.map((item) =>
      toStaffNotificationView(item, { diagnostics: canReadDiagnostics(actor.roles) }),
    ),
  };
}
