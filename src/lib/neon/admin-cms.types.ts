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
  payload: Record<string, unknown>;
  basePublishedVersion?: number | null;
  restoredFromRevisionId?: string | null;
};

export type CmsPublishInput = {
  resourceType: CmsResourceType;
  resourceId: string;
  revisionId: string;
};
export type CmsRestoreInput = { revisionId: string };
export type CmsArchiveInput = { resourceType: CmsResourceType; resourceId: string };
/** Every field this repo's CMS payloads actually store -- string/number/
 * boolean/string-array/null, never a nested object or function. Narrower
 * than `unknown` because TanStack Start's serialization check on a
 * createServerFn return type rejects `Record<string, unknown>`. */
export type CmsPayloadValue = string | number | boolean | string[] | null;

export type CmsEditorResult = {
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
