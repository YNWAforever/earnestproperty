import { isAnalyticsPrivatePath } from "./analytics/attribution.ts";
/** Compare with the document entry, not history's already-updated address. */
export function requiresDocumentIsolation(entryPath: string, nextPath: string, preload = false) {
  return !preload && isAnalyticsPrivatePath(entryPath) !== isAnalyticsPrivatePath(nextPath);
}
