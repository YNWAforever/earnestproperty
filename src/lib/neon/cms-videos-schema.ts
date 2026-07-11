const CMS_VIDEOS_TABLE = "cms_videos";

export function isMissingCmsVideosTableError(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String(error.message ?? "")
        : String(error);

  return (
    (code === "42P01" && message.includes(CMS_VIDEOS_TABLE)) ||
    message.includes(`relation "${CMS_VIDEOS_TABLE}" does not exist`)
  );
}
