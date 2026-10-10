import {
  isInternalCardHref,
  MAX_LISTING_CARDS,
  type LiveAgentCard,
} from "@/lib/ai/live-agent-reply";

// Pure state helpers for LiveAgentWidget.tsx, kept out of the component file so it exports
// components only (fast refresh).

export const LIVE_AGENT_REPLY_FALLBACK = "暫時未能回答，請稍後再試。";

const CARD_TYPES = new Set<LiveAgentCard["type"]>(["listing", "estate", "faq", "more"]);

function readCard(value: unknown): LiveAgentCard | null {
  if (!value || typeof value !== "object") return null;
  const card = value as Record<string, unknown>;
  if (typeof card.type !== "string" || !CARD_TYPES.has(card.type as LiveAgentCard["type"])) {
    return null;
  }
  if (typeof card.title !== "string" || !card.title.trim()) return null;
  if (!Array.isArray(card.lines) || !card.lines.every((line) => typeof line === "string")) {
    return null;
  }
  return {
    type: card.type as LiveAgentCard["type"],
    title: card.title,
    lines: card.lines as string[],
    href: typeof card.href === "string" ? card.href : null,
  };
}

/** The message route's body as the widget shows it: the reply's fixed copy (else the stored
 *  transcript text, else a fixed fallback) and only well-formed cards, at most
 *  MAX_LISTING_CARDS of them listings. `usable` is false when the text fell back, or when a
 *  listings reply has no listing card with a safe internal link: the widget then offers the
 *  handoff so the enquiry is never lost. */
export function readLiveAgentMessageResponse(data: unknown): {
  text: string;
  cards: LiveAgentCard[];
  usable: boolean;
} {
  const body = (data && typeof data === "object" ? data : {}) as {
    message?: { message_text?: unknown };
    reply?: { kind?: unknown; text?: unknown; cards?: unknown };
  };
  const replyText = body.reply?.text;
  const messageText = body.message?.message_text;
  const text =
    typeof replyText === "string" && replyText.trim()
      ? replyText
      : typeof messageText === "string" && messageText.trim()
        ? messageText
        : null;

  const cards: LiveAgentCard[] = [];
  let listings = 0;
  const rawCards = body.reply?.cards;
  for (const value of Array.isArray(rawCards) ? rawCards : []) {
    const card = readCard(value);
    if (!card) continue;
    if (card.type === "listing") {
      if (listings >= MAX_LISTING_CARDS) continue;
      listings += 1;
    }
    cards.push(card);
  }

  const listingsWithoutListing =
    body.reply?.kind === "listings" &&
    !cards.some((card) => card.type === "listing" && isInternalCardHref(card.href));
  return {
    text: text ?? LIVE_AGENT_REPLY_FALLBACK,
    cards,
    usable: text !== null && !listingsWithoutListing,
  };
}

/** The server decides when to offer the handoff; once offered it stays for the session. */
export function nextHandoffOffered(
  current: boolean,
  response: { handoffSuggested?: unknown },
): boolean {
  return current || response.handoffSuggested === true;
}
