import { ReactNode } from "react";

export function AdminToolbar({ filters, actions }: { filters: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border bg-background p-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-1 flex-wrap gap-2">{filters}</div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
