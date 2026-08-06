import { useBlocker } from "@tanstack/react-router";

import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";

const LEAVE_TITLE = "尚未儲存";
const LEAVE_DESCRIPTION = "你在此頁有未儲存的修改，離開後會遺失。確定要離開嗎？";
const LEAVE_CONFIRM = "離開並放棄修改";

/**
 * Blocks in-app navigation and browser unload while `isDirty` is true.
 *
 * A component rather than part of `useRouteLeaveGuard` for two reasons:
 * `useBlocker` requires router context and throws without it, so mounting it
 * conditionally lets a guarded form still render standalone (unit tests,
 * isolated previews); and it keeps the hooks module free of component exports.
 *
 * Prefer `useRouteLeaveGuard` over rendering this directly -- it does the
 * router-presence check for you.
 */
export function RouteLeaveBlocker({ isDirty }: { isDirty: boolean }) {
  const blocker = useBlocker({
    shouldBlockFn: () => isDirty,
    enableBeforeUnload: () => isDirty,
    disabled: !isDirty,
    withResolver: true,
  });

  if (blocker.status !== "blocked") return null;

  return (
    <AdminConfirmDialog
      open
      title={LEAVE_TITLE}
      description={LEAVE_DESCRIPTION}
      confirmLabel={LEAVE_CONFIRM}
      confirmVariant="destructive"
      onOpenChange={(open) => {
        if (!open) blocker.reset();
      }}
      onConfirm={blocker.proceed}
    />
  );
}
