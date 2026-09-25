import { useCallback, useState } from "react";

/** Refreshes only when a staff member clicks refresh or completes a mutation. */
export function useOperationsPulse() {
  const [pulse, setPulse] = useState(0);
  const refreshNow = useCallback(() => {
    setPulse((value) => value + 1);
  }, []);

  return { pulse, refreshNow };
}
