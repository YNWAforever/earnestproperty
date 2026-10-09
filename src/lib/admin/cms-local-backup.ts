import { toast } from "sonner";

type Clipboard = { writeText(text: string): Promise<void> } | null | undefined;
type Notify = { success(message: string): unknown; error(message: string): unknown };

/**
 * Copies the editor's local changes as JSON, the recovery copy staff keep when a save
 * conflicts. Resolves to null when copied, or to the text to show in the read-only
 * 本機修改備份（可複製） box when the clipboard refuses, so the edits are never lost.
 */
export async function copyCmsLocalBackup(
  payload: Record<string, unknown>,
  clipboard: Clipboard = globalThis.navigator?.clipboard,
  notify: Notify = toast,
): Promise<string | null> {
  const text = JSON.stringify(payload, null, 2);
  try {
    if (!clipboard) throw new Error("clipboard unavailable");
    await clipboard.writeText(text);
    notify.success("已複製本機修改。");
    return null;
  } catch {
    notify.error("未能自動複製，請在下方手動複製。");
    return text;
  }
}
