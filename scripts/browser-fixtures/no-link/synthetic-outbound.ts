// Session-only outbound queue/readback model. No network, DB or provider dispatch.
const actor = sessionStorage.getItem("no-link-fixture-actor") ?? "agent-a";
const storage = "no-link-fixture-outbound";
type Entry = {
  id: string;
  conversationId: string;
  actor: string;
  kind: string;
  state: string;
  text: string;
  error?: string | null;
};
const model = {
  calls: [] as { name: string; input: unknown }[],
  reservationReads: [] as { conversationId: string }[],
  mode: "ok",
  readFailure: false,
  release: null as null | (() => void),
};
Object.assign(window, { noLinkOutboundFixture: model });
const records = (): Entry[] => JSON.parse(sessionStorage.getItem(storage) ?? "[]");
const allowed = (id: string) =>
  ["agent-a", "manager"].includes(actor) &&
  ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"].includes(id);
async function queue(
  kind: string,
  input: {
    data: {
      requestId: string;
      conversationId: string;
      text?: string;
      templateId?: string;
      enquiryId?: string;
    };
  },
) {
  model.calls.push({ name: kind, input: { data: { ...input.data } } });
  const mode = model.mode;
  if (mode === "delay")
    await new Promise<void>((done) => {
      model.release = done;
    });
  if (!allowed(input.data.conversationId)) throw Error("Synthetic forbidden reply actor");
  const entries = records();
  let entry = entries.find((e) => e.id === input.data.requestId);
  if (!entry) {
    if (
      entries.some(
        (e) =>
          e.conversationId === input.data.conversationId &&
          ["unknown", "dispatching"].includes(e.state),
      )
    )
      return { ok: false, error: "OUTBOUND_RECONCILIATION_REQUIRED" };
    entry = {
      id: input.data.requestId,
      conversationId: input.data.conversationId,
      actor,
      kind,
      state: mode === "unknown" ? "unknown" : "queued",
      text: input.data.text ?? "合成範本",
    };
    entries.push(entry);
    sessionStorage.setItem(storage, JSON.stringify(entries));
  }
  if (mode === "timeout") throw Error("Synthetic response lost after queue");
  return { ok: true, intent: { id: entry.id, kind: entry.kind, state: entry.state } };
}
export const sendAdminConversationReply = (input: Parameters<typeof queue>[1]) =>
  queue("text", input);
export const sendAdminConversationTemplate = (input: Parameters<typeof queue>[1]) =>
  queue("template", input);
export async function fetchAdminOutboundReservation(input: { data: { conversationId: string } }) {
  // Keep new conversation-only readonly checks visible separately from the
  // existing send/request-specific read log used by the original assertions.
  model.reservationReads.push({ ...input.data });
  if (model.readFailure || sessionStorage.getItem("no-link-fixture-reservation-failure") === "true")
    throw Error("Synthetic reservation read unavailable");
  if (!allowed(input.data.conversationId)) throw Error("Synthetic conversation unavailable");
  const unresolved = records().filter(
    (e) =>
      e.conversationId === input.data.conversationId &&
      ["unknown", "dispatching"].includes(e.state),
  );
  const own = unresolved.find((e) => e.actor === actor);
  return {
    ok: true,
    reservation: {
      blocked: unresolved.length > 0,
      intent: own ? { id: own.id, kind: own.kind, state: own.state } : null,
    },
  };
}
export async function fetchAdminOutboundIntent(input: {
  data: { requestId: string; conversationId: string };
}) {
  model.calls.push({ name: "read", input });
  if (model.readFailure) throw Error("Synthetic outbound read unavailable");
  const entry = records().find(
    (e) =>
      e.id === input.data.requestId &&
      e.conversationId === input.data.conversationId &&
      e.actor === actor,
  );
  if (!entry || !allowed(input.data.conversationId)) throw Error("Synthetic request unavailable");
  return { ok: true, intent: { id: entry.id, kind: entry.kind, state: entry.state } };
}
export function syntheticOutboundMessages(conversationId: string) {
  return records()
    .filter((e) => e.conversationId === conversationId && allowed(conversationId))
    .map((e) => ({
      id: e.id,
      direction: "outbound",
      message_type: e.kind,
      text: e.text,
      status: e.state,
      error: e.error ?? (e.state === "unknown" ? "WOZTELL_DELIVERY_UNKNOWN" : null),
      created_at: new Date().toISOString(),
    }));
}
