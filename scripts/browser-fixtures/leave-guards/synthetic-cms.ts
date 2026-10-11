import { estate } from "./synthetic-api";
// FX-19d-1 H-08: the real page's payload must pass the server function's own schema.
import {
  cmsArchiveSchema,
  cmsPublishSchema,
  cmsRestoreSchema,
} from "../../../src/lib/neon/admin-write-schemas";

// The editor read returns the same payload for the opening object and the saved draft, as the
// server does; the estate dialog must therefore open clean.
export async function fetchAdminCmsEditor() {
  const fixture = (window as unknown as { leaveGuardFixture: { editorReads: number } })
    .leaveGuardFixture;
  setTimeout(() => (fixture.editorReads += 1), 0);
  const payload = { ...estate } as Record<string, unknown>;
  delete payload.updated_at;
  return {
    revisions: [],
    payload,
    publishedPayload: null,
    editState: {
      resourceId: estate.id,
      draftRevisionId: "rev-1",
      draftVersion: 1,
      draftEditVersion: 1,
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
export const saveAdminCmsDraft = async () => {
  throw new Error("not used by the leave guard fixture");
};
