import { useCallback, useEffect, useState } from "react";

type OperationsPollerOptions = {
  intervalMs: number;
  isVisible: () => boolean;
  subscribeVisibility: (listener: () => void) => () => void;
  setTimer: (listener: () => void, intervalMs: number) => number;
  clearTimer: (timer: number) => void;
  onPulse: () => void;
};

export function createOperationsPoller({
  intervalMs,
  isVisible,
  subscribeVisibility,
  setTimer,
  clearTimer,
  onPulse,
}: OperationsPollerOptions) {
  let started = false;
  let timer: number | undefined;
  let unsubscribe: (() => void) | undefined;
  let wasVisible = isVisible();

  function pulseFromTimer() {
    const visible = isVisible();
    wasVisible = visible;
    if (visible) onPulse();
  }

  function pulseOnVisibleTransition() {
    const visible = isVisible();
    if (visible && !wasVisible) onPulse();
    wasVisible = visible;
  }

  return {
    start() {
      if (started) return;
      started = true;
      wasVisible = isVisible();
      unsubscribe = subscribeVisibility(pulseOnVisibleTransition);
      timer = setTimer(pulseFromTimer, intervalMs);
    },
    stop() {
      if (!started) return;
      started = false;
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
}

export function useOperationsPulse(intervalMs = 30_000) {
  const [pulse, setPulse] = useState(0);
  const refreshNow = useCallback(() => {
    setPulse((value) => value + 1);
  }, []);

  useEffect(() => {
    const poller = createOperationsPoller({
      intervalMs,
      isVisible: () => document.visibilityState === "visible",
      subscribeVisibility: (listener) => {
        document.addEventListener("visibilitychange", listener);
        return () => document.removeEventListener("visibilitychange", listener);
      },
      setTimer: (listener, ms) => window.setInterval(listener, ms),
      clearTimer: (timer) => window.clearInterval(timer),
      onPulse: refreshNow,
    });
    poller.start();
    return () => poller.stop();
  }, [intervalMs, refreshNow]);

  return { pulse, refreshNow };
}
