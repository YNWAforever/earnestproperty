export const CMS_RESOURCE_TYPES = ["estate", "article", "video", "faq", "media"] as const;

export type CmsResourceType = (typeof CMS_RESOURCE_TYPES)[number];
export type CmsRevisionState = "draft" | "published" | "superseded" | "archived";

export function canPublishCmsRevision(roles: readonly string[]) {
  return roles.includes("admin") || roles.includes("manager");
}

export function nextCmsVersion(rows: ReadonlyArray<{ version_number: number }>) {
  return (rows[0]?.version_number ?? 0) + 1;
}

export function makeRestoreDraft(revision: {
  id: string;
  resource_type: CmsResourceType;
  resource_id: string;
  version_number: number;
  payload: Record<string, unknown>;
}) {
  return {
    resourceType: revision.resource_type,
    resourceId: revision.resource_id,
    basePublishedVersion: revision.version_number,
    payload: structuredClone(revision.payload),
    restoredFromRevisionId: revision.id,
  };
}
