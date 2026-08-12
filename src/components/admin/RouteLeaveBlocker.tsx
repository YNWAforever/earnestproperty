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
    // Block only when the PATHNAME changes, not on every navigate. Admin screens
    // keep their open record and filters in the URL, so closing a panel or
    // typing in a search box is a same-pathname navigate that only rewrites the
    // query string -- blocking those asked 尚未儲存 on keystroke-driven URL
    // updates. On the CRM leads page that produced two identical confirms for
    // one close (the panel's own dirty-close guard, then this one), and
    // cancelling the second left ?lead=<id> pointing at an already-closed panel.
    //
    // Compared on pathname rather than routeId deliberately: moving between two
    // listings (/admin/listings/a -> /admin/listings/b) keeps the SAME routeId,
    // and a dirty 20-field PropertyForm must still be protected there.
    shouldBlockFn: ({ current, next }) => isDirty && current.pathname !== next.pathname,
    // Tab close / reload is always a real exit, so it stays gated on isDirty alone.
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
