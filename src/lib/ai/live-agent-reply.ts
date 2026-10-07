export type LiveAgentReplyKind =
  | "listings"
  | "no_listings"
  | "listing_unavailable"
  | "estates"
  | "faq"
  | "handoff"
  | "no_match"
  | "error";

export type LiveAgentCard = {
  type: "listing" | "estate" | "faq" | "more";
  /** DB text only (title_zh / name_zh / FAQ question) or fixed copy for "more". */
  title: string;
  /** DB-derived lines (price summary, area, bedrooms) or the FAQ answer verbatim. */
  lines: string[];
  href: string | null;
};

export type LiveAgentReply = {
  kind: LiveAgentReplyKind;
  /** Fixed copy only. */
  text: string;
  cards: LiveAgentCard[];
  handoffSuggested: boolean;
};

// Written Chinese per owner decision 2026-10-07. No digits: a visitor-facing sentence
// must never carry a number that did not come from the database.
export const LIVE_AGENT_REPLY_COPY: Record<
  | "listings"
  | "no_listings"
  | "listing_unavailable"
  | "estates"
  | "estates_browse"
  | "faq"
  | "handoff"
  | "valuation"
  | "no_match"
  | "error"
  | "more_link"
  | "estate_line",
  string
> = {
  listings: "以下是網站上現時符合條件的公開盤源，詳情以盤源頁面為準：",
  no_listings: "網站暫時未有符合條件的公開盤源。你可以留下 WhatsApp 電話，持牌代理會為你物色。",
  listing_unavailable:
    "網站暫時查不到這個盤號，盤源可能已售出、租出或暫停放盤。你可以留下 WhatsApp 電話，持牌代理會為你跟進。",
  estates: "屋苑資料（例如校網、落成年份）請參閱屋苑頁面：",
  estates_browse:
    "想查看哪個屋苑？你可以點選下面的屋苑，或直接輸入屋苑名稱和房數，例如「碧堤半島 兩房」。",
  faq: "常見問題：",
  handoff: "好的，請留下 WhatsApp 電話，持牌代理會盡快與你聯絡。",
  valuation: "估價需由持牌代理按單位資料處理。請留下 WhatsApp 電話，我們會盡快與你聯絡。",
  no_match:
    "我暫時只能協助查詢網站上的盤源、屋苑和常見問題。你可以輸入屋苑名稱和房數，例如「碧堤半島 兩房」，或留下 WhatsApp 電話由持牌代理跟進。",
  error: "暫時未能查詢資料。你可以留下 WhatsApp 電話，持牌代理會為你跟進。",
  more_link: "查看全部符合條件的盤源",
  estate_line: "屋苑資料及盤源",
};

export const MAX_LISTING_CARDS = 3;

const HANDOFF_KINDS = new Set<LiveAgentReplyKind>([
  "handoff",
  "no_listings",
  "listing_unavailable",
  "no_match",
  "error",
]);

/** Offer the WhatsApp handoff when the visitor asked for it, when the reply could not answer, or
 *  when a listings reply shows no real listing card (only the "more" link): a visitor who sees no
 *  concrete listing must always be able to leave a number. */
export function replyOffersHandoff(
  reply: Pick<LiveAgentReply, "kind" | "cards">,
  handoffRequested: boolean,
): boolean {
  if (handoffRequested || HANDOFF_KINDS.has(reply.kind)) return true;
  return reply.kind === "listings" && !reply.cards.some((card) => card.type === "listing");
}
export const MAX_ESTATE_CARDS = 6;

const PATH_HREF_RE = /^\/(property|estate)\/([A-Za-z0-9%._-]+)$/;
const LISTINGS_HREF_RE = /^\/listings\?[A-Za-z0-9=&%._-]*$/;

/** ^/(property|estate)/[A-Za-z0-9%._-]+$ or ^/listings\?[A-Za-z0-9=&%._-]*$ */
export function isInternalCardHref(href: string | null): boolean {
  if (!href) return false;
  const path = PATH_HREF_RE.exec(href);
  if (path) return !/^\.+$/.test(path[2]) && !/%(?:2e|2f|5c)/i.test(path[2]);
  return LISTINGS_HREF_RE.test(href);
}

/** text, then one line per card: "• <title>（<lines joined by "，">）" and the href when present. */
export function replyTranscriptText(reply: Pick<LiveAgentReply, "text" | "cards">): string {
  const lines = reply.cards.map((card) => {
    const detail = card.lines.length > 0 ? `（${card.lines.join("，")}）` : "";
    return `• ${card.title}${detail}${card.href ? ` ${card.href}` : ""}`;
  });
  return [reply.text, ...lines].join("\n");
}
