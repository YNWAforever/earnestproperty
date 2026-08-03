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
export type CmsEditorResult = { row: CmsHubRow | null; revisions: CmsRevisionSummary[] };
export type CmsRevisionSummary = {
  id: string;
  versionNumber: number;
  state: CmsRevisionState;
  createdAt: string;
  createdBy: string | null;
};
