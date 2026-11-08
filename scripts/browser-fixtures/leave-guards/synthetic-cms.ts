import { article, draftSaves, estate } from "./synthetic-api";
// FX-19d-1 H-08: the real page's payload must pass the server function's own schema.
import {
  cmsArchiveSchema,
  cmsDraftSaveSchema,
  cmsPublishSchema,
  cmsRestoreSchema,
} from "../../../src/lib/neon/admin-write-schemas";

type Payload = Record<string, unknown>;
// The latest draft per resource, as the server keeps it: a re-read returns what was saved.
const drafts = new Map<string, { payload: Payload; version: number; editVersion: number }>();

function openingPayload(resourceType: string, resourceId: string): Payload {
  const saved = drafts.get(resourceId);
  if (saved) return saved.payload;
  const payload = { ...(resourceType === "article" ? article : estate) } as Payload;
  delete payload.updated_at;
  return payload;
}

// The editor read returns the same payload for the opening object and the saved draft, as the
// server does; the estate and article dialogs must therefore open clean.
export async function fetchAdminCmsEditor({
  data,
}: {
  data: { resourceType: string; resourceId: string };
}) {
  const fixture = (window as unknown as { leaveGuardFixture: { editorReads: number } })
    .leaveGuardFixture;
  setTimeout(() => (fixture.editorReads += 1), 0);
  const payload = openingPayload(data.resourceType, data.resourceId);
  const saved = drafts.get(data.resourceId);
  return {
    revisions: [],
    payload,
    publishedPayload: null,
    editState: {
      resourceId: data.resourceId,
      draftRevisionId: `rev-${saved?.version ?? 1}`,
      draftVersion: saved?.version ?? 1,
      draftEditVersion: saved?.editVersion ?? 1,
      currentPublishedVersion: null,
      basePublishedVersion: null,
      payload,
      restoredFromRevisionId: null,
    },
    row: null,
  };
}
export const archiveAdminCmsResource = async ({ data }: { data: unknown }) => {
  cmsArchiveSchema.parse(data);
  return {};
};
export const publishAdminCmsRevision = async ({ data }: { data: unknown }) => {
  cmsPublishSchema.parse(data);
  return {};
};
export const restoreAdminCmsRevision = async ({ data }: { data: unknown }) => {
  cmsRestoreSchema.parse(data);
  return {};
};
// The hub's estate and article draft saves: the server function's strict input schema, then the
// result shape admin-cms.server.ts `savedResult` returns (a new draft revision and edit state).
export const saveAdminCmsDraft = async ({ data }: { data: unknown }) => {
  const input = cmsDraftSaveSchema.parse(data);
  const resourceId = input.resourceId ?? crypto.randomUUID();
  const previous = drafts.get(resourceId);
  const version = (previous?.version ?? 1) + 1;
  const editVersion = (input.draftEditVersion ?? previous?.editVersion ?? 0) + 1;
  const payload = structuredClone(input.payload);
  drafts.set(resourceId, { payload, version, editVersion });
  draftSaves.push({ resourceType: input.resourceType, resourceId, payload });
  return {
    resourceId,
    revisionId: `rev-${version}`,
    versionNumber: version,
    savedAt: new Date().toISOString(),
    editState: {
      resourceId,
      draftRevisionId: `rev-${version}`,
      draftVersion: version,
      draftEditVersion: editVersion,
      currentPublishedVersion: null,
      basePublishedVersion: input.basePublishedVersion ?? null,
      payload,
      restoredFromRevisionId: null,
    },
  };
};
