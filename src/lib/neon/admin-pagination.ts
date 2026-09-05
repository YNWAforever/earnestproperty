import type {
  AdminLeadRow,
  AdminConversationRow,
  AdminConversationMessageRow,
  AdminEstateCmsRow,
  AdminArticleCmsRow,
  AdminCmsVideoRow,
  AdminFaqCmsRow,
  AdminMediaAssetRow,
} from "./admin-data.types";
export type CursorPage<T> = {
  rows: T[];
  nextCursor: string | null;
  total: number;
  newestCursor?: string | null;
};
export type AdminContactPageRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  opt_in_whatsapp: boolean | null;
  opted_out_whatsapp: boolean | null;
};
export type AdminPageRows = {
  leads: AdminLeadRow;
  contacts: AdminContactPageRow;
  conversations: AdminConversationRow;
  messages: AdminConversationMessageRow;
  estates: AdminEstateCmsRow;
  articles: AdminArticleCmsRow;
  videos: AdminCmsVideoRow;
  faqs: AdminFaqCmsRow;
  media: AdminMediaAssetRow;
};
export type AdminPageResource = keyof AdminPageRows;
export type AdminPageInput = {
  resource: AdminPageResource;
  cursor?: string | null;
  limit?: number;
  q?: string;
  stage?: string;
  intent?: string;
  source?: string;
  agentId?: string;
  optIn?: "all" | "yes" | "no";
  status?: string;
  scope?: string;
  conversationId?: string;
  messageIds?: string[];
  direction?: "older" | "newer";
};
const resources = [
  "leads",
  "contacts",
  "conversations",
  "messages",
  "estates",
  "articles",
  "videos",
  "faqs",
  "media",
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invalid(): never {
  throw new Error("INVALID_ADMIN_PAGE");
}
export function parseAdminPageInput(value: AdminPageInput): AdminPageInput & { limit: number } {
  if (!value || !resources.includes(value.resource)) invalid();
  const input = { ...value, limit: Math.min(50, Math.max(1, Math.trunc(value.limit ?? 50))) };
  if (!Number.isFinite(input.limit)) invalid();
  for (const key of ["q", "stage", "intent", "source", "agentId", "status", "scope"] as const) {
    const item = input[key];
    if (item != null && (typeof item !== "string" || item.length > (key === "q" ? 160 : 100)))
      invalid();
  }
  if (input.cursor != null && (typeof input.cursor !== "string" || input.cursor.length > 4096))
    invalid();
  if (input.optIn && !["all", "yes", "no"].includes(input.optIn)) invalid();
  if (input.direction && !["older", "newer"].includes(input.direction)) invalid();
  if (input.resource === "messages" && (!input.conversationId || !uuid.test(input.conversationId)))
    invalid();
  if (input.agentId && !["all", "unassigned"].includes(input.agentId) && !uuid.test(input.agentId))
    invalid();
  if (
    input.messageIds != null &&
    (!Array.isArray(input.messageIds) ||
      input.messageIds.length < 1 ||
      input.messageIds.length > 50 ||
      input.messageIds.some((id) => typeof id !== "string" || !uuid.test(id)))
  )
    invalid();
  const allowed: Record<AdminPageResource, string[]> = {
    leads: ["stage", "intent", "source", "agentId", "optIn"],
    contacts: ["optIn"],
    conversations: ["status"],
    messages: ["conversationId", "direction", "messageIds"],
    estates: [],
    articles: [],
    videos: [],
    faqs: ["scope"],
    media: [],
  };
  for (const key of [
    "stage",
    "intent",
    "source",
    "agentId",
    "optIn",
    "status",
    "scope",
    "conversationId",
    "messageIds",
    "direction",
  ])
    if ((input as Record<string, unknown>)[key] != null && !allowed[input.resource].includes(key))
      invalid();
  return input;
}
export type AdminCursor = { at: string; id: string };
export function encodeAdminCursor(cursor: AdminCursor, binding: string) {
  const bytes = new TextEncoder().encode(JSON.stringify({ ...cursor, binding }));
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
export function decodeAdminCursor(value: string, binding: string): AdminCursor {
  try {
    if (value.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(value)) invalid();
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    const parsed = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))),
    );
    if (
      parsed.binding !== binding ||
      !uuid.test(parsed.id) ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(parsed.at) ||
      !Number.isFinite(Date.parse(parsed.at))
    )
      invalid();
    return { at: parsed.at, id: parsed.id };
  } catch {
    invalid();
  }
}
export function pageBinding(input: AdminPageInput, scope: string) {
  const { cursor: _cursor, limit: _limit, direction: _direction, ...filters } = input;
  return JSON.stringify([
    scope,
    Object.fromEntries(Object.entries(filters).sort(([a], [b]) => a.localeCompare(b))),
  ]);
}
export function finishAdminPage<T extends { id: string; _cursor_at?: string }>(
  rows: T[],
  limit: number,
  binding: string,
  total: number,
): CursorPage<Omit<T, "_cursor_at">> {
  const visible = rows.slice(0, limit);
  const cursor = (row: T | undefined) =>
    row ? encodeAdminCursor({ at: row._cursor_at!, id: row.id }, binding) : null;
  return {
    rows: visible.map(({ _cursor_at, ...row }) => row),
    nextCursor: rows.length > limit ? cursor(visible.at(-1)) : null,
    newestCursor: cursor(visible[0]),
    total,
  };
}
export function mergeMessagePages<T extends { id: string; created_at: string }>(
  current: T[],
  incoming: T[],
): T[] {
  const byId = new Map(current.map((row) => [row.id, row]));
  for (const row of incoming) byId.set(row.id, row);
  return [...byId.values()].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
}
