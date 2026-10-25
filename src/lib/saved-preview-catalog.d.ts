export const PREVIEW_HOME_LIMIT: 9;
export function previewListingsForDeal<
  T extends { id: string; deal_type: string; posted: string | null },
>(listings: readonly T[], deal: string, limit?: number): T[];
