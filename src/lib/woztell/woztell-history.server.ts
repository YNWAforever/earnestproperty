import "@tanstack/react-start/server-only";

// Explicit .ts extension so `node --test` can import this module directly from
// the .mjs suite -- the same reason campaign-delivery.server.ts is imported
// with its extension in woztell.server.ts.
import { normalizeWoztellEvent } from "./woztell.server.ts";
import type { NormalizedWoztellEvent } from "./woztell.server.ts";

/**
 * Reading historical messages back out of WOZTELL.
 *
 * The webhook only ever captures what arrives while it is switched on. This
 * agency's channel ran for months before WOZTELL_CHANNEL_SECRET was set, and
 * every message from that period was rejected at the signature check and never
 * stored -- so the admin inbox starts empty no matter how long the channel has
 * been live. This module pulls that history back from WOZTELL and hands it to
 * the same ingest path the webhook uses.
 *
 * ## Why this needs a SECOND access token
 *
 * WOZTELL scopes are per-endpoint and these two do not overlap:
 *
 *   bot.api.woztell.com/sendResponses  -> ["bot:sendResponses", "bot:admin"]
 *   open.api.woztell.com/v3 conversationHistory
 *                                      -> ["conversation:read",
 *                                          "member:getConversation",
 *                                          "api:admin"]
 *
 * WOZTELL_BOT_ACCESS_TOKEN is minted for the first list, so it CANNOT read
 * history -- it will come back "User is not authenticated." rather than a
 * permission error. Hence WOZTELL_OPEN_API_TOKEN, generated at
 * Settings -> Access Tokens with `api:admin` (the one scope the dashboard
 * picker is documented to offer; `conversation:read` appears in the API
 * reference but not in the published scope table).
 *
 * https://doc.woztell.com/open-api-reference/
 */

const OPEN_API_ENDPOINT = "https://open.api.woztell.com/v3";

/** `first`/`last` are typed IntMax100 in the schema -- 101 is a validation error. */
export const MAX_PAGE_SIZE = 100;

/**
 * conversationHistory is documented at 30 calls/app/minute on the reference
 * page while the live schema string says 60. Design for the lower number: at
 * 100 rows per call, 30/min still moves 3,000 messages a minute, so there is
 * nothing to gain by racing the limit.
 */
export const DEFAULT_PAGE_DELAY_MS = 2_000;

export type WoztellChatNode = {
  _id?: unknown;
  createdAt?: unknown;
  from?: unknown;
  memberId?: unknown;
  channelId?: unknown;
  platform?: unknown;
  messageEvent?: unknown;
};

/**
 * Which end of the connection to walk.
 *
 * Both forms are schema-legal, and they are NOT equally proven:
 *
 *  - "forward" (first/after, hasNextPage/endCursor) is the form in WOZTELL's
 *    own documented example.
 *  - "backward" (last/before, hasPreviousPage/startCursor) is the form their
 *    shipped n8n node actually uses -- the only one demonstrably exercised
 *    against a live account.
 *
 * Neither the default sort order nor the behaviour of the unused form is
 * documented, and conversationHistory is the one major connection in the schema
 * with no sortBy argument to pin it down. So both are implemented: if a forward
 * run comes back empty against a channel that visibly has messages, that is the
 * signature of an unsupported direction rather than an empty inbox, and the
 * caller can flip this without a code change.
 */
export type PaginationMode = "forward" | "backward";

export type WoztellHistoryPage = {
  nodes: WoztellChatNode[];
  /** Cursor to pass back for the next page, in whichever direction was used. */
  cursor: string | null;
  hasMore: boolean;
  totalCount: number | null;
};

/**
 * `Chat.from` is a ChatSender enum -- BOT | MEMBER | ADMIN | INCOMING_WEBHOOK --
 * and is NOT the sender's phone number. (The webhook envelope's own `from`
 * field IS a phone; the two collide by name and mean different things. Same
 * trap as the `from:` Long argument, which is a timestamp filter.)
 *
 * We translate it into the `type` discriminator a webhook payload would have
 * carried, rather than setting `direction` ourselves, because direction feeds
 * the synthesized external_message_id fallback in normalizeWoztellEvent. If the
 * two ingest paths derived direction differently, the same message arriving via
 * both would produce two different ids, defeat the ON CONFLICT dedupe, and show
 * up twice in the inbox.
 */
export function chatSenderToWebhookType(sender: unknown): string | null {
  switch (String(sender ?? "").toUpperCase()) {
    case "BOT":
      return "BOT";
    case "ADMIN":
      // Staff replying from the WOZTELL console. The webhook calls this MANUAL.
      return "MANUAL";
    case "INCOMING_WEBHOOK":
      // Pushed in by an external system via WOZTELL's incoming-webhook API;
      // outbound from the customer's point of view, which is what direction means.
      return "RELAY";
    case "MEMBER":
      return null;
    default:
      // Unknown sender: fall through to inbound. Mislabelling a rare row is
      // recoverable; dropping it is not.
      return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Rebuild the webhook-shaped payload from a history row.
 *
 * WOZTELL nests the actual message under `messageEvent` in BOTH surfaces -- the
 * outbound webhook payload and the conversationHistory node carry the identical
 * envelope. That shared envelope is the whole reason this backfill can reuse
 * normalizeWoztellEvent instead of growing a second parser that would drift.
 */
export function chatNodeToWebhookPayload(node: WoztellChatNode): Record<string, unknown> {
  const type = chatSenderToWebhookType(node.from);
  const messageEvent = asRecord(node.messageEvent);

  const payload: Record<string, unknown> = {
    messageEvent,
    memberId: node.memberId ?? null,
    channelId: node.channelId ?? null,
  };

  // Only set `type` for outbound senders. normalizeWoztellEvent treats any
  // other value as inbound, and a literal "MEMBER" here would be misleading to
  // anyone reading the stored payload later.
  if (type) payload.type = type;

  return payload;
}

export function chatNodeToEvent(node: WoztellChatNode): NormalizedWoztellEvent {
  return normalizeWoztellEvent(chatNodeToWebhookPayload(node));
}

const HISTORY_QUERY = `
query EarnestChatHistory(
  $channelId: String
  $first: IntMax100
  $after: String
  $last: IntMax100
  $before: String
  $from: Long
  $to: Long
) {
  apiViewer {
    conversationHistory(
      channelId: $channelId
      first: $first
      after: $after
      last: $last
      before: $before
      from: $from
      to: $to
    ) {
      edges {
        cursor
        node {
          _id
          createdAt
          from
          memberId
          channelId
          platform
          messageEvent
        }
      }
      pageInfo {
        hasNextPage
        endCursor
        hasPreviousPage
        startCursor
        totalCount
      }
    }
  }
}`.trim();

export class WoztellHistoryError extends Error {
  // Declared and assigned explicitly rather than as a constructor parameter
  // property: `node --test` strips types without transforming, and parameter
  // properties are the one TS-only construct it rejects outright
  // (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX). The .mjs tests import this file
  // directly, so the shorthand would make the whole suite unrunnable.
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "WoztellHistoryError";
    this.status = status;
  }
}

export async function fetchWoztellHistoryPage(input: {
  token: string;
  channelId?: string | null;
  pageSize?: number;
  cursor?: string | null;
  mode?: PaginationMode;
  from?: number | null;
  to?: number | null;
  fetchImpl?: typeof fetch;
}): Promise<WoztellHistoryPage> {
  const doFetch = input.fetchImpl ?? fetch;
  const mode = input.mode ?? "forward";
  // Never omit the size: the sibling `files` connection documents a default of
  // 1, and an implicit 1 here would make a backfill crawl one message per call
  // without anything looking wrong.
  const pageSize = Math.min(Math.max(1, input.pageSize ?? MAX_PAGE_SIZE), MAX_PAGE_SIZE);
  const forward = mode === "forward";

  const res = await doFetch(OPEN_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify({
      query: HISTORY_QUERY,
      variables: {
        channelId: input.channelId ?? null,
        // Send exactly one direction's pair. Passing both first and last at once
        // is not documented as valid and risks a server-side validation error.
        first: forward ? pageSize : null,
        after: forward ? (input.cursor ?? null) : null,
        last: forward ? null : pageSize,
        before: forward ? null : (input.cursor ?? null),
        from: input.from ?? null,
        to: input.to ?? null,
      },
    }),
  });

  const rawBody = await res.text();
  let body: Record<string, unknown> = {};
  if (rawBody.trim()) {
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw new WoztellHistoryError("WOZTELL_INVALID_RESPONSE", res.status);
    }
  }

  if (!res.ok) {
    throw new WoztellHistoryError(`WOZTELL_HTTP_${res.status}`, res.status);
  }

  // WOZTELL returns auth failures as HTTP 200 with a GraphQL `errors` array
  // ("User is not authenticated."), so checking res.ok alone would silently
  // treat a bad token as an empty inbox -- exactly the false "no history"
  // answer this whole module exists to avoid.
  const errors = Array.isArray(body.errors) ? body.errors : [];
  if (errors.length > 0) {
    const message = String(asRecord(errors[0]).message ?? "unknown GraphQL error").slice(0, 300);
    throw new WoztellHistoryError(message, res.status);
  }

  const connection = asRecord(asRecord(asRecord(body.data).apiViewer).conversationHistory);
  const edges = Array.isArray(connection.edges) ? connection.edges : [];
  const pageInfo = asRecord(connection.pageInfo);
  const totalCount = pageInfo.totalCount;

  const rawCursor = forward ? pageInfo.endCursor : pageInfo.startCursor;
  const hasMore = (forward ? pageInfo.hasNextPage : pageInfo.hasPreviousPage) === true;

  return {
    nodes: edges.map((edge) => asRecord(asRecord(edge).node) as WoztellChatNode),
    cursor: rawCursor == null ? null : String(rawCursor),
    hasMore,
    totalCount: typeof totalCount === "number" ? totalCount : null,
  };
}

export type BackfillSummary = {
  pages: number;
  rows: number;
  ingested: number;
  duplicates: number;
  skipped: number;
  reachedEnd: boolean;
  /**
   * Where to resume. Null once the channel is exhausted.
   *
   * A full history can be far larger than one Vercel function invocation can
   * drain -- each row costs three or four round trips to Neon, and the platform
   * kills the request at 300s. So a run is bounded by maxPages and hands back
   * its cursor instead of trying to finish and timing out halfway with no way
   * to tell how far it got.
   */
  nextCursor: string | null;
};

/**
 * Page through the channel's history, handing every row to `ingest`.
 *
 * Deliberately order-agnostic. Nothing in WOZTELL's schema or docs states
 * whether conversationHistory returns newest-first or oldest-first, and there
 * is no sort argument to pin it down -- so this makes no assumption. It does
 * not have to: ingestion dedupes on external_message_id and advances recency
 * columns with GREATEST, both of which are order-independent. That also makes
 * the whole run safe to re-run and safe to overlap with the live webhook.
 */
export async function backfillWoztellHistory(input: {
  token: string;
  channelId?: string | null;
  from?: number | null;
  to?: number | null;
  maxPages?: number;
  pageDelayMs?: number;
  startCursor?: string | null;
  mode?: PaginationMode;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  ingest: (
    event: NormalizedWoztellEvent,
  ) => Promise<{ messageInserted: boolean; skipped: unknown }>;
}): Promise<BackfillSummary> {
  const maxPages = Math.max(1, input.maxPages ?? 50);
  const pageDelayMs = input.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS;
  const sleep = input.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const summary: BackfillSummary = {
    pages: 0,
    rows: 0,
    ingested: 0,
    duplicates: 0,
    skipped: 0,
    reachedEnd: false,
    nextCursor: null,
  };

  let cursor: string | null = input.startCursor ?? null;

  for (let page = 0; page < maxPages; page += 1) {
    const result: WoztellHistoryPage = await fetchWoztellHistoryPage({
      token: input.token,
      channelId: input.channelId,
      pageSize: MAX_PAGE_SIZE,
      cursor,
      mode: input.mode,
      from: input.from,
      to: input.to,
      fetchImpl: input.fetchImpl,
    });

    summary.pages += 1;
    summary.rows += result.nodes.length;

    for (const node of result.nodes) {
      const outcome = await input.ingest(chatNodeToEvent(node));
      if (outcome.skipped) summary.skipped += 1;
      else if (outcome.messageInserted) summary.ingested += 1;
      else summary.duplicates += 1;
    }

    if (!result.hasMore || !result.cursor) {
      summary.reachedEnd = true;
      summary.nextCursor = null;
      break;
    }

    // A cursor that stops advancing would otherwise spin until maxPages,
    // re-ingesting the same page each time.
    if (result.cursor === cursor) {
      summary.reachedEnd = true;
      summary.nextCursor = null;
      break;
    }

    cursor = result.cursor;
    summary.nextCursor = cursor;

    // Skip the courtesy delay after the final page -- it would just add dead
    // time to a request the caller is waiting on.
    const isLastAllowedPage = page === maxPages - 1;
    if (pageDelayMs > 0 && !isLastAllowedPage) await sleep(pageDelayMs);
  }

  return summary;
}
