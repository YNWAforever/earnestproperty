import type { CmsResourceType, CmsRevisionState } from "./cms-revisions";

export type CmsHubView = "mine" | "ready" | "published";

export type CmsHubRow = {
  resourceType: CmsResourceType;
  resourceId: string;
  title: string;
  slug: string | null;
  state: CmsRevisionState;
  latestRevisionId: string;
  latestVersion: number;
  publishedVersion: number | null;
  updatedAt: string;
  updatedBy: string | null;
};

export type CmsCategoryResult = { rows: CmsHubRow[]; unavailableReason?: string };

export type CmsDraftSaveInput = {
  resourceType: CmsResourceType;
  resourceId?: string;
  draftRevisionId?: string | null;
  payload: Record<string, unknown>;
  basePublishedVersion?: number | null;
  restoredFromRevisionId?: string | null;
  draftEditVersion?: number | null;
};

export type CmsPublishInput = {
  resourceType: CmsResourceType;
  resourceId: string;
  revisionId: string;
  basePublishedVersion?: number | null;
  draftEditVersion?: number | null;
};
/** Required at runtime for articles only; other CMS resource contracts stay unchanged. */
export type CmsArticleMutationTokens = {
  requestId: string;
  expectedVersion: number;
  editState: Omit<CmsEditState<never>, "payload">;
};
export type CmsRestoreInput = { revisionId: string; articleTokens?: CmsArticleMutationTokens };
export type CmsArchiveInput = {
  resourceType: CmsResourceType;
  resourceId: string;
  articleTokens?: CmsArticleMutationTokens;
};
/** Serializable JSON payloads include validated article links and editorial metadata. */
export type CmsPayloadValue =
  | string
  | number
  | boolean
  | null
  | CmsPayloadValue[]
  | { [key: string]: CmsPayloadValue };

export type CmsEditState<TPayload> = {
  resourceId: string;
  draftRevisionId: string | null;
  draftVersion: number | null;
  draftEditVersion: number | null;
  currentPublishedVersion: number | null;
  basePublishedVersion: number | null;
  payload: TPayload;
  restoredFromRevisionId: string | null;
};

export type CmsEditorResult = {
  publishedPayload: Record<string, CmsPayloadValue> | null;
  editState: CmsEditState<Record<string, CmsPayloadValue>> | null;
  row: CmsHubRow | null;
  revisions: CmsRevisionSummary[];
  /** The latest revision's raw payload -- needed to populate a comprehensive
   * editor form (CmsHubRow only carries a title/slug display projection). */
  payload: Record<string, CmsPayloadValue> | null;
};
export type CmsRevisionSummary = {
  id: string;
  versionNumber: number;
  state: CmsRevisionState;
  createdAt: string;
  createdBy: string | null;
};
