import "@tanstack/react-start/server-only";
import { requireStaffAccess } from "./auth.server.ts";
import { queryRows, transactionRows } from "./db.server.ts";
import {
  listMyStaffNotifications,
  acknowledgeStaffAssignment,
  requestStaffAssignmentHelp,
} from "./staff-notifications.server.ts";
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
      ? await listMyStaffNotifications(data, actor, deps.query)
      : action === "ack"
        ? await acknowledgeStaffAssignment(data, actor, deps)
        : await requestStaffAssignmentHelp(data, actor, deps)
  ) as A extends "list"
    ? Awaited<ReturnType<typeof listMyStaffNotifications>>
    : Awaited<ReturnType<typeof acknowledgeStaffAssignment>>;
}
