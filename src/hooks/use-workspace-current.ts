import { useCallback, useLayoutEffect, useRef } from "react";

/** Stop asynchronous work synchronously when its component lifetime ends. */
export function useWorkspaceCurrent(parent?: () => boolean) {
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return useCallback(() => active.current && (!parent || parent()), [parent]);
}
