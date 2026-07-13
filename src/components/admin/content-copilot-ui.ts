import type { ContentCopilotPatch, ContentCopilotValue } from "@/lib/ai/content-copilot";

export function contentCopilotCharacterCount(value: ContentCopilotValue | undefined) {
  if (value === null || value === undefined) return 0;
  return Array.isArray(value) ? value.join("\n").length : value.length;
}

export function getContentCopilotPatchSelection(
  patch: Pick<ContentCopilotPatch, "unsupportedClaims">,
  selected: boolean,
) {
  const disabled = patch.unsupportedClaims.length > 0;
  return { checked: disabled ? false : selected, disabled };
}

export function buildContentCopilotPartialUpdate(
  patches: ContentCopilotPatch[],
  selectedFields: string[],
): Record<string, ContentCopilotValue> {
  const selected = new Set(selectedFields);
  return Object.fromEntries(
    patches
      .filter((patch) => selected.has(patch.field) && patch.unsupportedClaims.length === 0)
      .map((patch) => [patch.field, patch.after]),
  );
}
