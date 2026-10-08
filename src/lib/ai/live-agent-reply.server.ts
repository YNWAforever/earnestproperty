import "@tanstack/react-start/server-only";

import { formatArea, sanitizeListingText } from "@/lib/format";
import { queryRows, stringOrEmpty, stringOrNull } from "@/lib/neon/db.server";
import { searchListingRows, searchListings } from "@/lib/neon/public-data.server";
import type { NeonPropertyRow } from "@/lib/neon/public-data.types";
import { propertyPriceSummary, publicPropertyNo, publicPropertyTitle } from "@/lib/property-public";

import {
  FAQ_MATCH_MIN_RATIO,
  FAQ_MATCH_MIN_SHARED,
  faqMatchScore,
  matchPublishedEstates,
  parseLiveAgentIntent,
  type LiveAgentIntent,
} from "./live-agent-intent";
import {
  LIVE_AGENT_REPLY_COPY as COPY,
  MAX_ESTATE_CARDS,
  MAX_LISTING_CARDS,
  replyOffersHandoff,
  type LiveAgentCard,
  type LiveAgentReply,
  type LiveAgentReplyKind,
} from "./live-agent-reply";

// The public live agent's only answer path (FX-11, D1 = a). It makes no model call. Its only
// data sources are published estates, published FAQs and the public listing search, all read
// on every message with no cache, so an unpublish or a withdrawal takes effect at once.

type PublishedEstate = {
  slug: string;
  name_zh: string;
  name_en: string | null;
  district_slug: string | null;
};
type PublishedFaq = { id: string; scope: string; question: string; answer: string };

/** Rows read per listing search before filtering; at most MAX_LISTING_CARDS become cards. */
const LISTING_FETCH_ROWS = 20;

async function readPublishedEstates(): Promise<PublishedEstate[]> {
  const rows = await queryRows<Record<string, unknown>>(
    `SELECT slug, name_zh, name_en, district_slug FROM estates WHERE published = true
     ORDER BY name_zh ASC LIMIT 500`,
  );
  return rows.map((row) => ({
    slug: stringOrEmpty(row.slug),
    name_zh: stringOrEmpty(row.name_zh),
    name_en: stringOrNull(row.name_en),
    district_slug: stringOrNull(row.district_slug),
  }));
}

async function readPublishedFaqs(): Promise<PublishedFaq[]> {
  const rows = await queryRows<Record<string, unknown>>(
    `SELECT id::text, scope, question, answer FROM faqs WHERE published = true
     ORDER BY sort_order ASC NULLS LAST, created_at ASC LIMIT 500`,
  );
  return rows.map((row) => ({
    id: stringOrEmpty(row.id),
    scope: stringOrEmpty(row.scope),
    question: stringOrEmpty(row.question),
    answer: stringOrEmpty(row.answer),
  }));
}

const PLACE_SCOPE_RE = /^(?:estate|district):/i;

/** Highest-scoring eligible FAQ that clears both thresholds; the visitor's own place first, then
 *  score, then the published sort order (the read order). A FAQ scoped to an estate or a district
 *  is eligible only when the visitor named that same place: a wrong place's fact is worse than
 *  no answer. Unscoped FAQs are always eligible. */
function bestFaq(
  text: string,
  faqs: PublishedFaq[],
  placeScopes: string[] = [],
): PublishedFaq | null {
  const named = new Set(placeScopes.map((scope) => scope.toLowerCase()));
  const ranked = faqs
    .filter((faq) => !PLACE_SCOPE_RE.test(faq.scope) || named.has(faq.scope.toLowerCase()))
    .map((faq, index) => ({ faq, index, score: faqMatchScore(text, faq.question) }))
    .filter(
      ({ score }) => score.shared >= FAQ_MATCH_MIN_SHARED && score.ratio >= FAQ_MATCH_MIN_RATIO,
    )
    .sort((a, b) => {
      const scopeA = named.has(a.faq.scope.toLowerCase()) ? 0 : 1;
      const scopeB = named.has(b.faq.scope.toLowerCase()) ? 0 : 1;
      return (
        scopeA - scopeB ||
        b.score.ratio - a.score.ratio ||
        b.score.shared - a.score.shared ||
        a.index - b.index
      );
    });
  return ranked[0]?.faq ?? null;
}

function faqCard(faq: PublishedFaq): LiveAgentCard {
  return { type: "faq", title: faq.question, lines: [faq.answer], href: null };
}

function estateCard(estate: PublishedEstate): LiveAgentCard {
  return {
    type: "estate",
    title: estate.name_zh,
    lines: [COPY.estate_line],
    href: "/estate/" + encodeURIComponent(estate.slug),
  };
}

function listingCard(row: NeonPropertyRow): LiveAgentCard {
  const area = formatArea(row.saleable_area);
  const lines = [propertyPriceSummary(row)];
  if (area) lines.push("實用 " + area);
  if (row.bedrooms === 0) lines.push("開放式");
  else if (row.bedrooms) lines.push(`${row.bedrooms} 房`);
  return {
    type: "listing",
    title: sanitizeListingText(publicPropertyTitle(row)) ?? row.title_zh,
    lines,
    href: "/property/" + encodeURIComponent(publicPropertyNo(row)),
  };
}

/** A row may become a card only with a public number (never a SYNC or UUID identity) and
 *  never when its estate is unpublished. */
function showableRows(rows: NeonPropertyRow[], publishedSlugs: Set<string>) {
  return rows.filter((row) => {
    if (!publicPropertyNo(row)) return false;
    const estateSlug = row.estates?.slug;
    return !estateSlug || publishedSlugs.has(estateSlug);
  });
}

function listingsHref(input: {
  deal: string;
  bedrooms: number | null;
  estateSlug: string | null;
  districtSlug: string | null;
}) {
  const params = new URLSearchParams({ deal: input.deal });
  if (input.bedrooms !== null) params.set("bedrooms", String(input.bedrooms));
  if (input.estateSlug) params.set("estate", input.estateSlug);
  else if (input.districtSlug) params.set("district", input.districtSlug);
  return "/listings?" + params.toString();
}

const sameNo = (a: string, b: string) =>
  a.replace(/-/g, "").toUpperCase() === b.replace(/-/g, "").toUpperCase();

async function findPublicListing(listingNo: string, publishedSlugs: Set<string>) {
  // The keyword search is a substring match, so a number stored as "C-018613" is not found by
  // "C018613" and vice versa: try the typed form, then the other one.
  const bare = listingNo.replace(/-/g, "");
  const hyphenated = bare.replace(/^([A-Z]+)(\d+)$/, "$1-$2");
  const keywords = [listingNo, listingNo.includes("-") ? bare : hyphenated];
  for (const keyword of keywords) {
    // Rows only: a number lookup never uses the total, so no count query runs.
    const rows = await searchListingRows({
      deal: "all",
      keyword,
      sort: "newest",
      page: 1,
      pageSize: LISTING_FETCH_ROWS,
    });
    const match = showableRows(rows, publishedSlugs).find(
      (row) =>
        sameNo(publicPropertyNo(row), listingNo) ||
        (row.listing_aliases ?? []).some((alias) => sameNo(alias, listingNo)),
    );
    if (match) return match;
  }
  return null;
}

/** browse: the generic estate list shown because no estate matched (offers the handoff). */
type Draft = { kind: LiveAgentReplyKind; text: string; cards: LiveAgentCard[]; browse?: boolean };

/** A browse list of estate cards, or the no-match reply when there is none to show: the browse
 *  copy invites the visitor to tap an estate below, so it is never sent with an empty list. */
function browseDraft(estates: PublishedEstate[]): Draft {
  if (estates.length === 0) return { kind: "no_match", text: COPY.no_match, cards: [] };
  return {
    kind: "estates",
    text: COPY.estates_browse,
    cards: estates.slice(0, MAX_ESTATE_CARDS).map(estateCard),
    browse: true,
  };
}

/** Listing cards for a search scoped to an estate, a district or (both null) the whole site. */
async function listingsDraft(
  intent: LiveAgentIntent,
  estate: PublishedEstate | null,
  districtSlug: string | null,
  publishedSlugs: Set<string>,
): Promise<Draft> {
  const deal = intent.deal ?? "all";
  const { rows, total } = await searchListings({
    deal,
    bedrooms: intent.bedrooms ?? undefined,
    ...(estate ? { estateSlug: estate.slug } : districtSlug ? { districtSlug } : {}),
    sort: "newest",
    page: 1,
    pageSize: LISTING_FETCH_ROWS,
  });
  // Filter a bounded larger page, then slice: newer rows without a public number (or on an
  // unpublished estate) must never hide a real listing behind "no listings".
  const showable = showableRows(rows, publishedSlugs);
  const cards = showable.slice(0, MAX_LISTING_CARDS).map(listingCard);
  if (cards.length === 0 && total <= rows.length) {
    return {
      kind: "no_listings",
      text: COPY.no_listings,
      cards: estate ? [estateCard(estate)] : [],
    };
  }
  // More exists when the page held more showable rows than shown, or the search has rows
  // beyond the fetched page (which /listings lists). If every fetched row was unshowable but
  // more exist, the visitor gets only the "more" link, never a false "no listings".
  if (showable.length > cards.length || total > rows.length) {
    cards.push({
      type: "more",
      title: COPY.more_link,
      lines: [],
      href: listingsHref({
        deal,
        bedrooms: intent.bedrooms,
        estateSlug: estate?.slug ?? null,
        districtSlug,
      }),
    });
  }
  return { kind: "listings", text: COPY.listings, cards };
}

async function decide(intent: LiveAgentIntent): Promise<Draft> {
  // 1. Valuation is always an agent's job.
  if (intent.valuation) return { kind: "handoff", text: COPY.valuation, cards: [] };
  // 1b. 放盤 without a valuation word: a seller wants an agent (existing handoff copy).
  if (intent.sellIntent) return { kind: "handoff", text: COPY.handoff, cards: [] };

  const estates = await readPublishedEstates();
  const publishedSlugs = new Set(estates.map((estate) => estate.slug));

  // 2. A public listing number: exact public number or alias, active rows only.
  if (intent.listingNo) {
    const row = await findPublicListing(intent.listingNo, publishedSlugs);
    return row
      ? { kind: "listings", text: COPY.listings, cards: [listingCard(row)] }
      : { kind: "listing_unavailable", text: COPY.listing_unavailable, cards: [] };
  }

  // 3. A published estate or a district.
  const matchedSlugs = matchPublishedEstates(intent.text, intent.estateSlugs, estates);
  const matchedEstates = matchedSlugs
    .map((slug) => estates.find((estate) => estate.slug === slug))
    .filter((estate): estate is PublishedEstate => Boolean(estate));
  const estate = matchedEstates[0] ?? null;
  const districtSlug = estate ? null : intent.districtSlug;

  if (estate || districtSlug) {
    if (intent.listingQuestion || intent.bedrooms !== null || intent.deal !== null) {
      return listingsDraft(intent, estate, districtSlug, publishedSlugs);
    }

    const faqs = await readPublishedFaqs();
    // Only places the visitor actually named: a matched estate and/or a typed district.
    const scopes = [
      ...(estate ? [`estate:${estate.slug}`] : []),
      ...(intent.districtSlug ? [`district:${intent.districtSlug}`] : []),
    ];
    const faq = bestFaq(intent.text, faqs, scopes);
    if (faq) {
      return {
        kind: "faq",
        text: COPY.faq,
        cards: [faqCard(faq), ...(estate ? [estateCard(estate)] : [])],
      };
    }
    if (matchedEstates.length > 0) {
      return {
        kind: "estates",
        text: COPY.estates,
        cards: matchedEstates.slice(0, MAX_ESTATE_CARDS).map(estateCard),
      };
    }
    // A district alone with no FAQ lists that district's published estates only (the estates
    // table's district_slug); an estate without one is never guessed into a district.
    return browseDraft(estates.filter((row) => row.district_slug === districtSlug));
  }

  // 3b. A buyer's 放盤 question with bedrooms or a deal but no place: the site-wide search.
  if (intent.buyerListingAsk) return listingsDraft(intent, null, null, publishedSlugs);

  // 4. A published FAQ.
  const faq = bestFaq(intent.text, await readPublishedFaqs());
  if (faq) return { kind: "faq", text: COPY.faq, cards: [faqCard(faq)] };

  // 5. Browsing without an estate.
  if (intent.estateBrowse || intent.deal !== null || intent.bedrooms !== null) {
    return browseDraft(estates);
  }

  // 6. and 7.
  if (intent.handoffRequested) return { kind: "handoff", text: COPY.handoff, cards: [] };
  return { kind: "no_match", text: COPY.no_match, cards: [] };
}

export async function buildLiveAgentReply(question: string): Promise<LiveAgentReply> {
  try {
    const intent = parseLiveAgentIntent(question);
    const { browse, ...draft } = await decide(intent);
    return {
      ...draft,
      handoffSuggested: replyOffersHandoff({ ...draft, browse }, intent.handoffRequested),
    };
  } catch (error) {
    // A code only: never the visitor's text, the SQL or the error message.
    console.error("[live-agent] LIVE_AGENT_REPLY_FAILED", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return { kind: "error", text: COPY.error, cards: [], handoffSuggested: true };
  }
}
