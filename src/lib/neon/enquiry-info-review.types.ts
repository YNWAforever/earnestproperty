import { z } from "zod";
const humanEvidence = {
  sourceReference: z.string().trim().min(3).max(500),
  statement: z.string().trim().min(3).max(4000),
};
export const enquiryPhoneReviewInput = z
  .object({
    phone: z.string().regex(/^852[456789][0-9]{7}$/),
    decision: z.enum(["approved", "revoked"]),
    expectedRevision: z.number().int().nonnegative(),
    profileHash: z.string().regex(/^[a-f0-9]{64}$/),
    conflictHash: z.string().regex(/^[a-f0-9]{64}$/),
    ...humanEvidence,
  })
  .strict();
export const enquiryHeldReplyInput = z
  .object({
    receiptId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    expectedMemberRevision: z.number().int().nonnegative(),
    resolution: z.enum(["customer", "staff"]),
    ...humanEvidence,
  })
  .strict();
export type EnquiryPhoneReviewInput = z.infer<typeof enquiryPhoneReviewInput>;
export type EnquiryHeldReplyInput = z.infer<typeof enquiryHeldReplyInput>;
export type EnquiryPhoneReviewItem = {
  phone: string;
  names: string[];
  eligible: boolean;
  retired?: boolean;
  state: "policy" | "unreviewed" | "approved" | "revoked" | "changed";
  revision: number;
  profileHash: string;
  conflictHash: string;
  customerConflictCount: number;
  memberAssociated: boolean;
};
export type EnquiryHeldReplyItem = {
  receiptId: string;
  receivedAt: string;
  messageAt: string | null;
  text: string;
  fromPhone: string | null;
  expectedRevision: number;
  expectedMemberRevision: number;
  contactNames: string[];
  customerAllowed: boolean;
  staffAllowed: boolean;
  blockedReason: string | null;
};
export type EnquiryInfoReviewState = {
  phones: EnquiryPhoneReviewItem[];
  heldReplies: EnquiryHeldReplyItem[];
  heldCount: number;
  hasMore: boolean;
};
export type EnquiryHeldReplyResult = {
  receiptId: string;
  resolved: true;
  resolution: "customer" | "staff";
  messageInserted: boolean;
};
