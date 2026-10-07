export type GradedCard = {
  type?: string;
  title: string;
  lines: string[];
  href: string | null;
};

export type GradedReply = { kind: string; text: string; cards: GradedCard[] };

/** /(?<![A-Za-z0-9$.,])(?:\+?852[\s-]?)?[4-9]\d{3}[\s-]?\d{4}(?![0-9])/ — prices are always
 *  grouped or abbreviated, so they never match. */
export declare function containsPhonePattern(text: string): boolean;

/** A fixed set of >= 300 Simplified-only characters; excludes characters that are also standard
 *  Traditional (里 台 后 干 只 面 才 云 松 志 制 余 范 系 …). */
export declare const SIMPLIFIED_ONLY_CHARACTERS: ReadonlySet<string>;

/** Distinct Simplified-only characters in text, in first-seen order. */
export declare function simplifiedCharacters(text: string): string[];

/** Same contract as isInternalCardHref (live-agent-reply.ts), in plain JS. */
export declare function isEvalInternalHref(href: string | null): boolean;

/** failures: "UNGROUNDED_NUMBER:<raw>", "PHONE_PATTERN", "SIMPLIFIED:<chars>",
 *  "COLLOQUIAL:<chars>", "UNSAFE_LINK:<href>", "INACTIVE_LISTING_CARD:<no>",
 *  "AVAILABILITY_CLAIM_WITHOUT_LISTING"
 *  (text or card uses an AVAILABILITY_PHRASES entry unless kind is "listings" with an active listing card). */
export declare function gradeReply(input: {
  reply: GradedReply;
  /** Every DB value of the rows the reply may cite. */
  facts: Array<string | number>;
  /** Public numbers currently active in the DB. */
  activeListingNos: string[];
}): { ok: boolean; failures: string[] };

/** Phrases that claim a listing is on the market now; allowed only in a listings reply with an
 *  active listing card. */
export declare const AVAILABILITY_PHRASES: readonly string[];

/** Colloquial Cantonese characters (嘅 咗 冇 啲 唔 哋 係 喺 嘢 嚟 佢 噉 咩 嗰); 係 in 關係/聯係/係數 is
 *  written Chinese and not flagged. gradeReply reports "COLLOQUIAL:<chars>". */
export declare const COLLOQUIAL_CHARACTERS: ReadonlySet<string>;
export declare function colloquialCharacters(text: string): string[];

/** PENDING OWNER REVIEW: the FX-03 post-handoff reply, the only reply text the register grader
 *  exempts (exact match). */
export declare const REGISTER_EXEMPT_PENDING_OWNER_REVIEW: string;
