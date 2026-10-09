// The 問樓助手 trigger classes, shared by the lazy LiveAgentLauncher and the loaded
// LiveAgentWidget so the button does not move when the widget replaces the launcher.
/** Mobile: a 44×44 icon in the bars' reserved right slot. lg+: today's floating pill, unchanged. */
export function liveAgentTriggerClass(docked: boolean): string {
  return docked
    ? "fixed bottom-[calc(0.5rem+env(safe-area-inset-bottom))] right-3 z-50 h-11 w-11 rounded-md p-0 shadow-none lg:bottom-5 lg:right-5 lg:w-auto lg:rounded-full lg:px-4 lg:shadow-lg"
    : "fixed bottom-4 right-4 z-50 h-11 rounded-full px-4 shadow-lg sm:bottom-5 sm:right-5";
}

/** Docked, the visible label is screen-reader-only below lg; the button keeps its aria-label. */
export function liveAgentTriggerLabelClass(docked: boolean): string | undefined {
  return docked ? "sr-only lg:not-sr-only" : undefined;
}

export function liveAgentTriggerIconClass(docked: boolean): string {
  return docked ? "h-5 w-5 lg:mr-2" : "mr-2 h-5 w-5";
}
