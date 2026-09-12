import "@tanstack/react-start/server-only";
import { boundedProviderFetch } from "./provider-fetch.ts";
export class InboxPreDispatchError extends Error {
  readonly code = "WOZTELL_INBOX_PREFLIGHT_BLOCKED";
  constructor() {
    super("WOZTELL_INBOX_PREFLIGHT_BLOCKED");
  }
}
export type InboxConfig = {
  verificationRef: string;
  appId: string;
  appIntegrationId: string;
  signature: string;
  channelId: string;
  listThreadsUrl: string;
  listUsersUrl: string;
  assignUrl: string;
  internalMessageUrl: string;
};
export function inboxConfig(): InboxConfig | null {
  const e = process.env;
  const values = [
    e.EP_WA_INBOX_VERIFICATION_REF,
    e.WOZTELL_APP_ID,
    e.EP_WA_INBOX_INTEGRATION_ID,
    e.EP_WA_INBOX_SIGNATURE,
    e.EP_WA_COMPANY_CHANNEL_ID,
    e.EP_WA_INBOX_LIST_THREADS_URL,
    e.EP_WA_INBOX_LIST_USERS_URL,
    e.EP_WA_INBOX_ASSIGN_URL,
    e.EP_WA_INBOX_INTERNAL_MESSAGE_URL,
  ];
  if (values.some((v) => !v)) return null;
  return {
    verificationRef: values[0]!,
    appId: values[1]!,
    appIntegrationId: values[2]!,
    signature: values[3]!,
    channelId: values[4]!,
    listThreadsUrl: values[5]!,
    listUsersUrl: values[6]!,
    assignUrl: values[7]!,
    internalMessageUrl: values[8]!,
  };
}
/** Explicit tenant-pinned paths: never probe alternative prefixes, never use sendResponses for notes. */
export function createInboxApi(
  config: InboxConfig | null = inboxConfig(),
  fetchImpl: typeof fetch = fetch,
) {
  if (!config?.verificationRef) throw new Error("WOZTELL_INBOX_CAPABILITY_UNVERIFIED");
  const c = config;
  for (const key of [
    "listThreadsUrl",
    "listUsersUrl",
    "assignUrl",
    "internalMessageUrl",
  ] as const) {
    const u = new URL(c[key]);
    if (
      u.protocol !== "https:" ||
      u.hostname !== "api.inbox.woztell.sanuker.com" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      throw new Error("WOZTELL_INBOX_CONFIGURATION_INVALID");
  }
  const payload = JSON.stringify({ appIntegration: c.appIntegrationId, app: c.appId });
  const headers = {
    "Content-Type": "application/json",
    "X-Woztell-Payload": payload,
    "X-Woztell-SignedContext": `${c.signature}.${Buffer.from(payload).toString("base64")}`,
  };
  async function call(url: string, body?: Record<string, unknown>) {
    const { response, text } = await boundedProviderFetch(
      url,
      {
        method: body ? "POST" : "GET",
        headers,
        redirect: "error",
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      { fetchImpl },
    );
    if (!response.ok) throw new Error("WOZTELL_INBOX_REQUEST_FAILED");
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error("WOZTELL_INBOX_RESULT_INVALID");
    }
    if (result.ok !== 1) throw new Error("WOZTELL_INBOX_RESULT_UNCONFIRMED");
    return result;
  }
  async function readAuthoritativeAssignment(scope: { channelId: string; memberId: string }) {
    if (scope.channelId !== c.channelId) throw new Error("WOZTELL_INBOX_SCOPE_MISMATCH");
    const u = new URL(c.listThreadsUrl);
    u.searchParams.set("channelId", scope.channelId);
    u.searchParams.set("memberId", scope.memberId);
    u.searchParams.set("limit", "2");
    const r = await call(u.toString());
    const data = r.data;
    if (!Array.isArray(data) || data.length !== 1)
      throw new Error("WOZTELL_INBOX_SCOPE_UNVERIFIED");
    const t = data[0];
    if (
      t.channelId !== scope.channelId ||
      t.memberId !== scope.memberId ||
      (t.userId !== null && typeof t.userId !== "string") ||
      typeof t.folder !== "string"
    )
      throw new Error("WOZTELL_INBOX_SCOPE_UNVERIFIED");
    return {
      inboxUserId: typeof t.userId === "string" ? t.userId : "",
      folderId: t.folder as string,
    };
  }
  return {
    verificationRef: c.verificationRef,
    readAuthoritativeAssignment,
    async execute(scope: {
      beforeSend?: () => Promise<void>;
      channelId: string;
      memberId: string;
      inboxUserId: string;
      folderId: string;
    }) {
      // Selected direct assignment adapter only. Folder must already match; no hidden second routing mechanism.
      const before = await readAuthoritativeAssignment(scope);
      if (before.folderId !== scope.folderId) throw new Error("WOZTELL_INBOX_FOLDER_MISMATCH");
      await scope.beforeSend?.();
      await call(c.assignUrl, { memberId: scope.memberId, userId: scope.inboxUserId });
      return { accepted: true };
    },
    async postPrivateNote(scope: {
      channelId: string;
      memberId: string;
      inboxUserId: string;
      folderId: string;
      message: string;
      beforeSend?: () => Promise<void>;
    }) {
      try {
        const actual = await readAuthoritativeAssignment(scope);
        if (actual.inboxUserId !== scope.inboxUserId || actual.folderId !== scope.folderId)
          throw new Error("WOZTELL_INBOX_HANDLER_MISMATCH");
        await scope.beforeSend?.();
      } catch {
        throw new InboxPreDispatchError();
      }
      const r = await call(c.internalMessageUrl, {
        memberId: scope.memberId,
        message: scope.message,
      });
      if (r.memberId !== scope.memberId) throw new Error("WOZTELL_INBOX_SCOPE_UNVERIFIED");
      return { state: "accepted" as const, evidenceKind: "private_note_posted" as const };
    },
  };
}
