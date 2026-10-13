import { useEffect, useState } from "react";
import { useStaffWorkspaceCurrent } from "@/hooks/use-staff-workspace";
import { fetchAdminAgentEditorContext } from "@/lib/neon/admin-data";
import type { AdminAgentEditorContext } from "@/lib/neon/admin-data.types";

/** The route loader is a preflight; its cached capability can outlive membership. */
export function useAgentEditorContext(identity: string) {
  const isCurrent = useStaffWorkspaceCurrent(identity);
  const [context, setContext] = useState<AdminAgentEditorContext | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setPending(true);
    fetchAdminAgentEditorContext()
      .then((value) => {
        if (cancelled || !isCurrent()) return;
        setContext(value);
        setError(false);
      })
      .catch(() => {
        if (!cancelled && isCurrent()) setError(true);
      })
      .finally(() => {
        if (!cancelled && isCurrent()) setPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, isCurrent]);
  return { context, pending, error, retry: () => setAttempt((value) => value + 1) };
}
