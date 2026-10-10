import { estate } from "./synthetic-api";

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
export const archiveAdminCmsResource = async () => ({});
export const publishAdminCmsRevision = async () => ({});
export const restoreAdminCmsRevision = async () => ({});
export const saveAdminCmsDraft = async () => {
  throw new Error("not used by the leave guard fixture");
};
