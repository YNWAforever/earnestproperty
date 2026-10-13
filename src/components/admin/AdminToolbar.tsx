import type { ReactNode } from "react";

/** A fieldset preserves the caller's form ownership and disables its complete action scope. */
export function AdminToolbar({
  filters,
  actions,
  summary,
  disabled = false,
}: {
  filters: ReactNode;
  actions?: ReactNode;
  summary?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div data-admin-toolbar className="mb-4 w-full min-w-0 rounded-lg border bg-background p-3">
      <fieldset
        disabled={disabled}
        aria-label="篩選及操作"
        className="flex min-w-0 flex-wrap items-end gap-3"
      >
        <div className="admin-toolbar-fields flex min-w-0 flex-1 basis-64 flex-wrap items-end gap-2">
          {filters}
        </div>
        {actions ? <div className="flex min-w-0 max-w-full flex-wrap gap-2">{actions}</div> : null}
      </fieldset>
      {summary ? <div className="mt-3 text-sm text-muted-foreground">{summary}</div> : null}
    </div>
  );
}
