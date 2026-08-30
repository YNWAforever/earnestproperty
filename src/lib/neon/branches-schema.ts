const BRANCHES_TABLE = "branches";

/**
 * Mirrors isMissingCmsVideosTableError (cms-videos-schema.ts): the branches
 * table is new in this same deploy (20260830160000_branches_entity.sql), so
 * a database that hasn't run that migration yet must not 500 every page
 * that tries to resolve an agent's branch_id -- it should just report no
 * branches, exactly like an unmigrated cms_videos table degrades to no
 * videos rather than a broken page.
 */
export function isMissingBranchesTableError(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String(error.message ?? "")
        : String(error);

  return (
    (code === "42P01" && message.includes(BRANCHES_TABLE)) ||
    message.includes(`relation "${BRANCHES_TABLE}" does not exist`)
  );
}
