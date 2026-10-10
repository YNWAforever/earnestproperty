import { useState } from "react";

/**
 * The editor value as it was when this record was opened: the baseline for "unsaved" until
 * the record's saved payload has loaded. It resets when the editor closes or a different
 * record (by id) opens, the same lifetime as the 內容中心 dialogs' opening dirty check.
 */
export function useOpeningSnapshot<T extends { id?: string }>(value: T | null): T | null {
  const [snapshot, setSnapshot] = useState<{ value: T } | null>(value ? { value } : null);
  if (value === null) {
    if (snapshot !== null) setSnapshot(null);
    return null;
  }
  if (snapshot === null || snapshot.value.id !== value.id) {
    setSnapshot({ value });
    return value;
  }
  return snapshot.value;
}
