export type InboxCandidate = {
  userId: string;
  displayName: string;
  email: string | null;
  channelId: string;
  role: string | null;
};
export type InboxCandidatePage = {
  items: InboxCandidate[];
  nextCursor: string | null;
  checkedAt: string;
};
export type InboxFolder = {
  folderKey: string;
  displayName: string;
  providerFolderId: string;
  source: "admin_catalog";
  version: number;
};
export type InboxSelectionReview = {
  evidenceId: string;
  result: "verified" | "denied";
  expiresAt: string;
  reasons: string[];
};
