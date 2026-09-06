export function cmsEditorHasChanges(
  value: Record<string, unknown>,
  saved: Record<string, unknown> | null,
) {
  return (
    !saved ||
    Object.entries(value).some(
      ([key, entry]) => key !== "id" && JSON.stringify(entry) !== JSON.stringify(saved[key]),
    )
  );
}
