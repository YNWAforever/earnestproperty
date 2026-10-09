import { useSyncExternalStore } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { staffSessionStore } from "@/components/admin/staff-session";
import { canReadDiagnostics } from "@/lib/control-plane/permissions";

export type TechnicalDetailRow = { label: string; value: string };

/**
 * FX-17a G-11: 「技術資料」, the admin-only home for ids and provider evidence. The server sends
 * diagnostics to admins only; this renders nothing without them or without an admin session,
 * so it never becomes the guard.
 */
export function AdminTechnicalDetails({
  rows,
  defaultOpen = false,
  className,
}: {
  rows: TechnicalDetailRow[] | null;
  defaultOpen?: boolean;
  className?: string;
}) {
  const { session } = useSyncExternalStore(
    staffSessionStore.subscribe,
    staffSessionStore.getSnapshot,
    staffSessionStore.getSnapshot,
  );
  const diagnosticsRead = session?.status === "ok" && canReadDiagnostics(session.roles);
  if (!rows || !diagnosticsRead) return null;
  return (
    <Collapsible defaultOpen={defaultOpen} className={className ?? "text-xs text-muted-foreground"}>
      <CollapsibleTrigger className="group inline-flex min-h-8 items-center gap-1 underline-offset-2 hover:underline">
        技術資料
        <ChevronDown
          aria-hidden="true"
          className="size-3 transition-transform group-data-[state=open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 space-y-0.5 break-all">
          {rows.map((row, index) => (
            <p key={`${row.label}-${index}`}>{`${row.label}：${row.value}`}</p>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
