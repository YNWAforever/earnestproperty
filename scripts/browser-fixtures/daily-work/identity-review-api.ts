// FX-12 Task 4: synthetic port for @/lib/neon/contact-identity-review. Two open reviews, one of
// each reason. Resolution state lives in localStorage, so a second tab of the same browser
// context sees the first tab's resolve (like a shared database row) and gets the 409.
// Masked phones only; no real customer, phone or member id.
import { ServerFnResponseError } from "@/lib/neon/server-fn-response";
import type {
  IdentityReviewAction,
  IdentityReviewRow,
} from "@/lib/neon/contact-identity-review.types";

const now = "2026-10-08T02:00:00.000Z";
const contact = (id: string, name: string, last4: string, leadId: string) => ({
  id,
  name,
  maskedPhone: `•••• ${last4}`,
  hasWhatsapp: true,
  optedOut: false,
  openLeadIds: [leadId],
  leadCount: 1,
});
const REVIEWS: IdentityReviewRow[] = [
  {
    id: "7c000000-0000-4000-8000-00000000c001",
    reason: "whatsapp_identity_conflict",
    status: "open",
    a: contact(
      "7c000000-0000-4000-8000-00000000a001",
      "合成甲",
      "0101",
      "40000000-0000-4000-8000-000000000001",
    ),
    b: contact(
      "7c000000-0000-4000-8000-00000000b001",
      "合成乙",
      "0102",
      "40000000-0000-4000-8000-000000000002",
    ),
    conversationId: "7c000000-0000-4000-8000-00000000d001",
    messageCount: 2,
    lastMessageAt: now,
    createdAt: now,
    resolvedAt: null,
    resolvedByName: null,
    note: null,
  },
  {
    id: "7c000000-0000-4000-8000-00000000c002",
    reason: "phone_format_duplicate",
    status: "open",
    a: contact(
      "7c000000-0000-4000-8000-00000000a002",
      "合成丙",
      "0103",
      "40000000-0000-4000-8000-000000000003",
    ),
    b: contact(
      "7c000000-0000-4000-8000-00000000b002",
      "合成丙",
      "0103",
      "40000000-0000-4000-8000-000000000004",
    ),
    conversationId: null,
    messageCount: 0,
    lastMessageAt: null,
    createdAt: now,
    resolvedAt: null,
    resolvedByName: null,
    note: null,
  },
];
// FX-12 fix round 1: with sessionStorage identity-review-unnamed=true, a third conflict whose
// two sides are both unnamed (未命名客戶), so only the side and the masked digits tell them apart.
if (sessionStorage.getItem("identity-review-unnamed") === "true")
  REVIEWS.push({
    ...REVIEWS[0],
    id: "7c000000-0000-4000-8000-00000000c003",
    a: {
      ...contact(
        "7c000000-0000-4000-8000-00000000a003",
        "",
        "0201",
        "40000000-0000-4000-8000-000000000005",
      ),
      name: null,
    },
    b: {
      ...contact(
        "7c000000-0000-4000-8000-00000000b003",
        "",
        "0202",
        "40000000-0000-4000-8000-000000000006",
      ),
      name: null,
    },
    conversationId: "7c000000-0000-4000-8000-00000000d003",
  });
const state = { calls: [] as { name: string; role: string; input: unknown }[] };
declare global {
  interface Window {
    identityReviewFixture: typeof state;
  }
}
window.identityReviewFixture = state;
const role = () => window.dailyWorkFixture?.role ?? sessionStorage.getItem("daily-work-role");
const statusKey = (id: string) => `fx12-identity-review:${id}`;
const resolvedStatus = (id: string) => localStorage.getItem(statusKey(id));
function requireManager() {
  if (!["admin", "manager"].includes(role() ?? ""))
    throw new ServerFnResponseError("Forbidden", 403);
}

/** Open reviews left, for the attention count of the daily-work fixture. */
export function syntheticIdentityReviewsOpen() {
  return REVIEWS.filter((review) => !resolvedStatus(review.id)).length;
}

export async function fetchContactIdentityReviews(input: {
  status: "open" | "resolved";
  cursor?: string | null;
}) {
  state.calls.push({ name: "list", role: role() ?? "", input });
  requireManager();
  const rows = REVIEWS.filter((review) =>
    input.status === "open" ? !resolvedStatus(review.id) : Boolean(resolvedStatus(review.id)),
  );
  return { rows, nextCursor: null, openCount: syntheticIdentityReviewsOpen() };
}

export async function resolveContactIdentityReviewItem(input: {
  id: string;
  action: IdentityReviewAction;
  note?: string | null;
}) {
  state.calls.push({ name: "resolve", role: role() ?? "", input });
  requireManager();
  const review = REVIEWS.find((item) => item.id === input.id);
  if (!review) throw new ServerFnResponseError("Not found", 404);
  if (resolvedStatus(review.id)) throw new ServerFnResponseError("REVIEW_ALREADY_RESOLVED", 409);
  const status = input.action.startsWith("link_")
    ? "linked"
    : input.action === "dismiss"
      ? "dismissed"
      : input.action;
  localStorage.setItem(statusKey(review.id), status);
  return {
    ok: true as const,
    status: status as IdentityReviewRow["status"],
    linkedContactId: input.action === "link_b" ? (review.b?.id ?? null) : null,
  };
}
