import { ShieldAlert } from "lucide-react";

/**
 * Shown in place of a manager/admin-only page once the staff session has loaded and the
 * signed-in role cannot open it. Before this, such a page said 正在核實管理員權限… forever.
 * The server still refuses every read; this only tells the person why the page is empty.
 */
export function AdminNoPermission() {
  return (
    <div
      role="status"
      data-admin-no-permission
      className="rounded-lg border border-warning-accent/30 bg-warning p-5 text-sm text-warning-foreground"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-base font-semibold">沒有權限</h2>
          <p className="mt-1">此頁只供經理或管理員使用。如需要，請聯絡管理員。</p>
        </div>
      </div>
    </div>
  );
}
