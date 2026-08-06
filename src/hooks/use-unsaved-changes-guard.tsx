import { useCallback, useState } from "react";
import { useRouter } from "@tanstack/react-router";

import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { RouteLeaveBlocker } from "@/components/admin/RouteLeaveBlocker";

/**
 * Guards against silently destroying half-entered work.
 *
 * Before this existed, `grep -rn "useBlocker\|beforeunload" src` returned zero
 * hits, and three separate admin surfaces threw away staff input with no
 * warning: a 20-field listing form (any sidebar click or browser back), every
 * CMS editor dialog (one stray click on the dim overlay), and the CRM lead
 * panel (Esc, overlay click, or opening another row).
 *
 * Two distinct shapes are needed, because only one of them is a route change:
 *
 * - `useRouteLeaveGuard` -- leaving the page. Wraps TanStack Router's
 *   `useBlocker`, whose `enableBeforeUnload` also covers tab close / reload.
 * - `useDirtyCloseGuard` -- closing a Dialog or Sheet, which is local state and
 *   never touches the router, so `useBlocker` cannot see it.
 */

const LEAVE_TITLE = "尚未儲存";
const LEAVE_DESCRIPTION = "你在此頁有未儲存的修改，離開後會遺失。確定要離開嗎？";
const LEAVE_CONFIRM = "離開並放棄修改";

/**
 * Blocks in-app navigation and browser unload while `isDirty` is true, and
 * renders the confirm dialog. Mount the returned `dialog` anywhere in the tree.
 */
export function useRouteLeaveGuard(isDirty: boolean) {
  // `useBlocker` requires router context and throws without it. Keeping it in a
  // child component -- mounted only when a router is present -- lets a guarded
  // form still render standalone (unit tests, isolated previews) with no guard
  // instead of crashing, without ever calling a hook conditionally.
  const router = useRouter({ warn: false });
  const dialog = router ? <RouteLeaveBlocker isDirty={isDirty} /> : null;
  return { dialog };
}

/**
 * For modals/sheets. Call `requestClose()` from `onOpenChange(false)` instead of
 * closing directly: when clean it closes immediately, when dirty it asks first.
 *
 * `confirmDescription` is worth overriding per surface -- "你未儲存的 FAQ 修改"
 * beats a generic message when staff are deciding whether to lose work.
 */
export function useDirtyCloseGuard({
  isDirty,
  onClose,
  description = LEAVE_DESCRIPTION,
}: {
  isDirty: boolean;
  onClose: () => void;
  description?: string;
}) {
  const [pending, setPending] = useState(false);

  const requestClose = useCallback(() => {
    if (isDirty) {
      setPending(true);
      return;
    }
    onClose();
  }, [isDirty, onClose]);

  const dialog = pending ? (
    <AdminConfirmDialog
      open
      title={LEAVE_TITLE}
      description={description}
      confirmLabel="放棄修改"
      confirmVariant="destructive"
      onOpenChange={(open) => {
        if (!open) setPending(false);
      }}
      onConfirm={() => {
        setPending(false);
        onClose();
      }}
    />
  ) : null;

  return { requestClose, dialog };
}
