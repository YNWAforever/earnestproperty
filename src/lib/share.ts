import { toast } from "sonner";

/**
 * Shares a title+URL via the native Web Share API, falling back to copying
 * the URL to the clipboard with a toast confirmation when Web Share isn't
 * available. This is the exact mechanism property.$listingNo.tsx's
 * handleShare originally implemented inline -- extracted here so every
 * other share action (e.g. listings.tsx's card share buttons) reuses it
 * instead of a second, possibly-drifting copy.
 */
export async function shareUrl(title: string, url: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title, url });
    } catch {
      /* user cancelled */
    }
    return;
  }
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(url);
    toast.success("已複製連結");
  }
}
