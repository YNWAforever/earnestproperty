import "@tanstack/react-start/server-only";
import { z } from "zod";
import { queryRows } from "./db.server.ts";
import { createInboxApi } from "../woztell/inbox-api.server.ts";
import type { StaffAccess } from "./auth.server.ts";
import type {
  InboxCandidate,
  InboxCandidatePage,
  InboxFolder,
  InboxSelectionReview,
} from "./inbox-directory.types.ts";

type Actor = Pick<StaffAccess, "staffId" | "roles">;
type Provider = Pick<ReturnType<typeof createInboxApi>, "listUsers">;
type Ports = {
  query?: typeof queryRows;
  provider?: Provider;
  rateLimit?: (key: string) => Promise<void>;
  now?: () => Date;
};
const listSchema = z
  .object({
    query: z.string().trim().max(80).default(""),
    folderKey: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
      .optional(),
    cursor: z.string().min(1).max(500).optional(),
  })
  .strict();
const verifySchema = z
  .object({
    staffId: z.string().uuid(),
    userId: z.string().trim().min(1).max(120),
    folderKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    expectedVersion: z.number().int().positive().nullable(),
  })
  .strict();
const folderSchema = z
  .object({
    folderKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    displayName: z.string().trim().min(1).max(120),
    providerFolderId: z.string().trim().min(1).max(120),
    expectedVersion: z.number().int().positive().nullable(),
  })
  .strict();

function scope() {
  const channelId = process.env.EP_WA_COMPANY_CHANNEL_ID;
  const providerScope = process.env.EP_WA_INBOX_INTEGRATION_ID;
  if (!channelId || !providerScope)
    throw new Response("INBOX_CONNECTION_NEEDS_ADMIN", { status: 409 });
  return { channelId, providerScope };
}
async function authorize(actor: Actor, query: typeof queryRows) {
  if (!actor.roles.some((role) => role === "admin" || role === "manager"))
    throw new Response("Forbidden", { status: 403 });
  const [row] = await query(
    "SELECT s.id FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$1::uuid AND s.active AND r.role IN ('admin','manager') LIMIT 1",
    [actor.staffId],
  );
  if (!row) throw new Response("Forbidden", { status: 403 });
}
async function limit(actor: Actor, scopeKey: string, ports: Ports) {
  const key = "wa-inbox-directory:" + scopeKey + ":" + actor.staffId;
  if (ports.rateLimit) return ports.rateLimit(key);
  const { enforceRateLimit } = await import("../ratelimit.server.ts");
  return enforceRateLimit({ key, limit: 30, windowSeconds: 60 });
}
function provider(ports: Ports): Provider {
  if (ports.provider) return ports.provider;
  try {
    return createInboxApi();
  } catch {
    throw new Response("INBOX_CONNECTION_NEEDS_ADMIN", { status: 409 });
  }
}
function providerFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (message === "WOZTELL_INBOX_AUTH_DENIED")
    throw new Response("INBOX_CONNECTION_NEEDS_ADMIN", { status: 409 });
  if (message === "WOZTELL_INBOX_RATE_LIMITED")
    throw new Response("INBOX_PROVIDER_RATE_LIMITED", { status: 429 });
  if (message === "WOZTELL_PROVIDER_TIMEOUT" || message === "WOZTELL_INBOX_UNAVAILABLE")
    throw new Response("INBOX_PROVIDER_UNAVAILABLE", { status: 503 });
  throw new Response("INBOX_DIRECTORY_UNVERIFIED", { status: 502 });
}
async function findFolder(
  query: typeof queryRows,
  folderKey: string,
  tenant: ReturnType<typeof scope>,
) {
  const [row] = await query<{ provider_folder_id: string; version: number }>(
    "SELECT provider_folder_id,version FROM whatsapp_inbox_folders WHERE provider_scope=$1 AND channel_id=$2 AND folder_key=$3 AND active",
    [tenant.providerScope, tenant.channelId, folderKey],
  );
  if (!row) throw new Response("INBOX_FOLDER_NOT_CONFIGURED", { status: 409 });
  return { folderId: row.provider_folder_id, version: Number(row.version) };
}
export async function listInboxFolders(actor: Actor, ports: Ports = {}): Promise<InboxFolder[]> {
  const query = ports.query ?? queryRows;
  await authorize(actor, query);
  const tenant = scope();
  const rows = await query<{
    folder_key: string;
    display_name: string;
    provider_folder_id: string;
    version: number;
  }>(
    "SELECT folder_key,display_name,provider_folder_id,version FROM whatsapp_inbox_folders WHERE provider_scope=$1 AND channel_id=$2 AND active ORDER BY display_name,folder_key",
    [tenant.providerScope, tenant.channelId],
  );
  return rows.map((row) => ({
    folderKey: row.folder_key,
    displayName: row.display_name,
    providerFolderId: row.provider_folder_id,
    source: "admin_catalog",
    version: Number(row.version),
  }));
}
export async function saveInboxFolder(value: unknown, actor: Actor, ports: Ports = {}) {
  const query = ports.query ?? queryRows;
  const input = folderSchema.parse(value);
  await authorize(actor, query);
  const tenant = scope();
  let row: { version: number } | undefined;
  try {
    [row] = await query<{ version: number }>(
      `INSERT INTO whatsapp_inbox_folders(
        provider_scope,channel_id,folder_key,display_name,provider_folder_id,
        created_by,updated_by
      )
      SELECT $1,$2,$3,$4,$5,$6::uuid,$6::uuid
      WHERE EXISTS (SELECT 1 FROM staff_users a JOIN staff_roles r ON r.staff_user_id=a.id
        WHERE a.id=$6::uuid AND a.active AND r.role IN ('admin','manager'))
        AND ($7::int IS NULL AND NOT EXISTS (
        SELECT 1 FROM whatsapp_inbox_folders WHERE provider_scope=$1 AND channel_id=$2 AND folder_key=$3
      ))
      ON CONFLICT(provider_scope,channel_id,folder_key) DO UPDATE SET
        display_name=EXCLUDED.display_name,
        provider_folder_id=EXCLUDED.provider_folder_id,
        updated_by=EXCLUDED.updated_by,updated_at=now(),
        version=whatsapp_inbox_folders.version+1
      WHERE whatsapp_inbox_folders.version=$7::int
        AND EXISTS (SELECT 1 FROM staff_users a JOIN staff_roles r ON r.staff_user_id=a.id
          WHERE a.id=$6::uuid AND a.active AND r.role IN ('admin','manager'))
      RETURNING version`,
      [
        tenant.providerScope,
        tenant.channelId,
        input.folderKey,
        input.displayName,
        input.providerFolderId,
        actor.staffId,
        input.expectedVersion,
      ],
    );
  } catch (error) {
    if ((error as { code?: string })?.code === "23505")
      throw new Response("INBOX_FOLDER_IDENTITY_CONFLICT", { status: 409 });
    throw error;
  }
  if (!row) throw new Response("INBOX_FOLDER_VERSION_CONFLICT", { status: 409 });
  return { folderKey: input.folderKey, version: Number(row.version) };
}

type CachedPage = {
  items: Awaited<ReturnType<Provider["listUsers"]>>["items"];
  nextCursor: string | null;
  checkedAt: string;
  expiresAt: number;
};
const pages = new Map<string, CachedPage>();
export async function listInboxCandidates(
  value: unknown,
  actor: Actor,
  ports: Ports = {},
): Promise<InboxCandidatePage> {
  const query = ports.query ?? queryRows;
  const input = listSchema.parse(value);
  await authorize(actor, query);
  const tenant = scope();
  await limit(actor, tenant.providerScope + ":" + tenant.channelId, ports);
  const folder = input.folderKey ? await findFolder(query, input.folderKey, tenant) : null;
  const now = (ports.now ?? (() => new Date()))();
  const key = JSON.stringify([
    tenant.providerScope,
    tenant.channelId,
    folder?.folderId ?? null,
    input.cursor ?? null,
  ]);
  let page = pages.get(key);
  if (!page || page.expiresAt <= now.getTime()) {
    let result: Awaited<ReturnType<Provider["listUsers"]>>;
    try {
      result = await provider(ports).listUsers({
        channelId: tenant.channelId,
        folderId: folder?.folderId,
        after: input.cursor,
        limit: 50,
      });
    } catch (error) {
      providerFailure(error);
    }
    page = { ...result, checkedAt: now.toISOString(), expiresAt: now.getTime() + 30_000 };
    if (pages.size > 200) pages.clear();
    pages.set(key, page);
  }
  const needle = input.query.toLocaleLowerCase();
  const items: InboxCandidate[] = page.items
    .filter(
      (item) =>
        !needle ||
        item.name.toLocaleLowerCase().includes(needle) ||
        item.email?.toLocaleLowerCase().includes(needle),
    )
    .map((item) => ({
      userId: item.userId,
      displayName: item.name,
      email: item.email,
      channelId: item.channelId,
      role: item.role,
    }));
  return { items, nextCursor: page.nextCursor, checkedAt: page.checkedAt };
}
export async function verifyInboxSelection(
  value: unknown,
  actor: Actor,
  ports: Ports = {},
): Promise<InboxSelectionReview> {
  const query = ports.query ?? queryRows;
  const input = verifySchema.parse(value);
  await authorize(actor, query);
  const tenant = scope();
  await limit(actor, tenant.providerScope + ":" + tenant.channelId, ports);
  const folder = await findFolder(query, input.folderKey, tenant);
  const [current] = await query(
    `SELECT s.id FROM staff_users s WHERE s.id=$1::uuid AND s.active
       AND (($2::int IS NULL AND NOT EXISTS (
         SELECT 1 FROM whatsapp_staff_channels m WHERE m.staff_id=s.id AND m.channel_id=$3
       )) OR ($2::int IS NOT NULL AND EXISTS (
         SELECT 1 FROM whatsapp_staff_channels m WHERE m.staff_id=s.id AND m.channel_id=$3 AND m.version=$2::int
       )))`,
    [input.staffId, input.expectedVersion, tenant.channelId],
  );
  if (!current) throw new Response("MAPPING_VERSION_CONFLICT", { status: 409 });
  const api = provider(ports);
  const seen = new Set<string>();
  let cursor: string | null = null;
  let found = false;
  for (let page = 0; page < 20; page++) {
    let result: Awaited<ReturnType<Provider["listUsers"]>>;
    try {
      result = await api.listUsers({
        channelId: tenant.channelId,
        folderId: folder.folderId,
        userId: input.userId,
        after: cursor,
        limit: 50,
      });
    } catch (error) {
      providerFailure(error);
    }
    if (
      result.items.some(
        (item) => item.userId !== input.userId || item.channelId !== tenant.channelId,
      )
    )
      throw new Response("INBOX_DIRECTORY_UNVERIFIED", { status: 502 });
    if (result.items.some((item) => item.userId === input.userId)) {
      found = true;
      break;
    }
    if (!result.nextCursor) break;
    if (seen.has(result.nextCursor))
      throw new Response("INBOX_DIRECTORY_INCOMPLETE", { status: 409 });
    seen.add(result.nextCursor);
    cursor = result.nextCursor;
    if (page === 19) throw new Response("INBOX_DIRECTORY_INCOMPLETE", { status: 409 });
  }
  const checkedAt = (ports.now ?? (() => new Date()))();
  const expiresAt = new Date(checkedAt.getTime() + 5 * 60_000);
  const result = found ? "verified" : "denied";
  const [event] = await query<{ id: string }>(
    `INSERT INTO whatsapp_staff_mapping_reviews(
       staff_id,channel_id,provider_scope,inbox_user_id,folder_id,basis,result,
       checked_at,expires_at,actor_id,mapping_version,reason_code
     )
     SELECT s.id,$2,$3,$4,$5,'provider_verified',$6,$7::timestamptz,$8::timestamptz,
       $9::uuid,$10::int,$11
     FROM staff_users s
     JOIN whatsapp_inbox_folders f ON f.provider_scope=$3 AND f.channel_id=$2
       AND f.folder_key=$12 AND f.provider_folder_id=$5 AND f.version=$13::int AND f.active
     WHERE s.id=$1::uuid AND s.active
       AND EXISTS (SELECT 1 FROM staff_users a JOIN staff_roles r ON r.staff_user_id=a.id
         WHERE a.id=$9::uuid AND a.active AND r.role IN ('admin','manager'))
       AND (($10::int IS NULL AND NOT EXISTS (
         SELECT 1 FROM whatsapp_staff_channels m WHERE m.staff_id=s.id AND m.channel_id=$2
       )) OR ($10::int IS NOT NULL AND EXISTS (
         SELECT 1 FROM whatsapp_staff_channels m WHERE m.staff_id=s.id AND m.channel_id=$2 AND m.version=$10::int
       )))
     RETURNING id`,
    [
      input.staffId,
      tenant.channelId,
      tenant.providerScope,
      input.userId,
      folder.folderId,
      result,
      checkedAt.toISOString(),
      expiresAt.toISOString(),
      actor.staffId,
      input.expectedVersion,
      found ? null : "folder_access_denied",
      input.folderKey,
      folder.version,
    ],
  );
  if (!event) throw new Response("MAPPING_VERSION_CONFLICT", { status: 409 });
  return {
    evidenceId: event.id,
    result,
    expiresAt: expiresAt.toISOString(),
    reasons: found ? [] : ["folder_access_denied"],
  };
}
