export type EnquiryInfoReceiptContext = Readonly<{ receiptId: string }>;
export type EnquiryInfoReceiptReview = {
  receiptId: string;
  reason: "sender_identity_unresolved";
};
/** Only the controlled server service can attach an authorized release to this opaque object. */
export type EnquiryInfoReleaseToken = Readonly<object>;
export type EnquiryInfoHeldReceiptResolution = {
  receiptId: string;
  expectedRevision: number;
  memberDecisionId: string;
  resolution: "customer" | "staff";
  evidence: { sourceReference: string; statement: string };
};
export function isEnquiryInfoReviewOutcome(
  value: unknown,
): value is { receiptReview: EnquiryInfoReceiptReview } {
  if (!value || typeof value !== "object" || !("receiptReview" in value)) return false;
  const review = value.receiptReview;
  return (
    !!review &&
    typeof review === "object" &&
    "receiptId" in review &&
    typeof review.receiptId === "string" &&
    "reason" in review &&
    review.reason === "sender_identity_unresolved"
  );
}
