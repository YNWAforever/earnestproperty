/** FX-12 Task 4: the 「可能重複客戶」 / 「身分待核對」 review list. Client-safe types only. */
export type IdentityReviewReason = "whatsapp_identity_conflict" | "phone_format_duplicate";
export type IdentityReviewAction =
  | "link_a"
  | "link_b"
  | "link_new" // conflict only
  | "same_person"
  | "different_people"
  | "dismiss"; // duplicate only
export type IdentityReviewStatus =
  | "open"
  | "linked"
  | "same_person"
  | "different_people"
  | "dismissed";
export type IdentityReviewContact = {
  id: string;
  name: string | null;
  /** "•••• 4567"; never the full number. */
  maskedPhone: string | null;
  hasWhatsapp: boolean;
  optedOut: boolean;
  openLeadIds: string[];
  leadCount: number;
};
export type IdentityReviewRow = {
  id: string;
  reason: IdentityReviewReason;
  status: IdentityReviewStatus;
  a: IdentityReviewContact | null;
  b: IdentityReviewContact | null;
  conversationId: string | null;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
  note: string | null;
};
export type IdentityReviewPage = {
  rows: IdentityReviewRow[];
  nextCursor: string | null;
  openCount: number;
};
export type IdentityReviewResolution = {
  ok: true;
  status: IdentityReviewStatus;
  linkedContactId: string | null;
};

export const CONFLICT_ACTIONS: readonly IdentityReviewAction[] = ["link_a", "link_b", "link_new"];
export const DUPLICATE_ACTIONS: readonly IdentityReviewAction[] = [
  "same_person",
  "different_people",
  "dismiss",
];
