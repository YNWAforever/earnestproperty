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
};
const model = {
  calls: [] as { name: string; input: unknown }[],
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
      error: null,
      created_at: new Date().toISOString(),
    }));
}
