// Session-only presentation model; no Auth, DB, provider or real notification.
import type { StaffNotificationItem } from "../../../src/lib/neon/staff-notifications.types";
import { toStaffNotificationView } from "../../../src/lib/neon/staff-notification-view.js";
const actor = sessionStorage.getItem("no-link-fixture-actor") ?? "agent-a";
const storage = "no-link-fixture-staff-work-record";
const notificationId = "60000000-0000-4000-8000-000000000001";
const model = {
  calls: [] as { name: string; input?: unknown }[],
  mode: "ok",
  readFailure: false,
  release: null as null | (() => void),
};
Object.assign(window, { noLinkStaffWorkFixture: model });
function record(): StaffNotificationItem {
  const saved = sessionStorage.getItem(storage);
  if (saved) return JSON.parse(saved);
  return {
    id: notificationId,
    inquiryId: "30000000-0000-4000-8000-000000000001",
    conversationId: "10000000-0000-4000-8000-000000000001",
    assignmentVersion: 3,
    purpose: "action_required",
    workState: "pending",
    requestedStaffId: "20000000-0000-4000-8000-000000000002",
    requestedName: "合成指定同事乙",
    handlerStaffId: "20000000-0000-4000-8000-000000000001",
    handlerName: "合成同事甲",
    mismatchReason: "由原有負責人協調",
    publicListingNo: "A074714",
    dealType: "sale",
    source: "28Hse",
    responseDueAt: null,
    firstHumanResponseAt: null,
    acknowledgedAt: null,
    helpRequestedAt: null,
    createdAt: new Date().toISOString(),
    canAct: true,
    attempts: [
      {
        transport: "inbox_private_note",
        state: "accepted",
        evidenceKind: "private_note_posted",
        error: null,
        acceptedAt: new Date().toISOString(),
        acceptedSource: "synthetic-model",
        deliveredAt: null,
        deliveredSource: null,
        readAt: null,
        readSource: null,
      },
    ],
  };
}
function allowed() {
  return ["agent-a", "manager"].includes(actor);
}
export async function fetchMyStaffNotifications(input: { status?: string }) {
  model.calls.push({ name: "read", input });
  if (model.readFailure) throw Error("Synthetic staff work read unavailable");
  if (!allowed() || sessionStorage.getItem("no-link-fixture-staff-work") !== "true")
    return { available: true, items: [], nextCursor: null };
  // The server's own view function, keyed on the synthetic session's role (FX-17a).
  const role = (window as unknown as { noLinkFixture?: { membershipRole?: string } }).noLinkFixture
    ?.membershipRole;
  const item = toStaffNotificationView(record(), { diagnostics: role === "admin" });
  return {
    available: true,
    items: input.status === "pending" && item.workState !== "pending" ? [] : [item],
    nextCursor: null,
  };
}
async function update(input: {
  notificationId: string;
  expectedAssignmentVersion: number;
  reason?: string;
}) {
  model.calls.push({ name: input.reason ? "help" : "ack", input: { ...input } });
  const mode = model.mode;
  if (mode === "delay")
    await new Promise<void>((done) => {
      model.release = done;
    });
  const item = record();
  if (!allowed()) throw Error("Synthetic forbidden actor");
  if (
    input.notificationId !== item.id ||
    input.expectedAssignmentVersion !== item.assignmentVersion ||
    mode === "stale"
  )
    throw Error("Synthetic stale assignment");
  if (mode === "refused") throw Error("Synthetic update refused");
  if (input.reason && (!input.reason.trim() || input.reason.length > 500))
    throw Error("Synthetic invalid reason");
  if (input.reason) item.helpRequestedAt = new Date().toISOString();
  else {
    item.workState = "acknowledged";
    item.acknowledgedAt ??= new Date().toISOString();
  }
  sessionStorage.setItem(storage, JSON.stringify(item));
  if (mode === "timeout") throw Error("Synthetic response lost after update");
  return { ok: true };
}
export const confirmStaffNotification = (input: {
  notificationId: string;
  expectedAssignmentVersion: number;
}) => update(input);
export const askStaffNotificationHelp = (input: {
  notificationId: string;
  expectedAssignmentVersion: number;
  reason: string;
}) => update(input);
