// The 問樓助手 trigger classes, shared by the lazy LiveAgentLauncher and the loaded
// LiveAgentWidget so the button does not move when the widget replaces the launcher.
//
// The base is main's floating pill, byte for byte. Every other class is a `max-lg:` variant
// keyed on `html:has([data-mobile-action-bar])` (see components/site/mobile-action-bar.ts).
// Below lg, and only while a bottom bar is on the page, the pill becomes a 44x44 icon in the
// bar's reserved right slot. Without a bar, and at lg+, it is exactly main's pill.

export const LIVE_AGENT_PILL_CLASS =
  "fixed bottom-4 right-4 z-50 h-11 rounded-full px-4 shadow-lg sm:bottom-5 sm:right-5";

const DOCKED_TRIGGER_CLASS =
  "max-lg:[html:has([data-mobile-action-bar])_&]:bottom-[calc(0.5rem+env(safe-area-inset-bottom))] max-lg:[html:has([data-mobile-action-bar])_&]:right-3 max-lg:[html:has([data-mobile-action-bar])_&]:w-11 max-lg:[html:has([data-mobile-action-bar])_&]:rounded-md max-lg:[html:has([data-mobile-action-bar])_&]:p-0 max-lg:[html:has([data-mobile-action-bar])_&]:shadow-none";

/** On a phone beside a bar, a 44×44 icon in the bar's right slot. Otherwise, main's pill. */
export function liveAgentTriggerClass(): string {
  return `${LIVE_AGENT_PILL_CLASS} ${DOCKED_TRIGGER_CLASS}`;
}

/** Docked, the visible label is screen-reader-only; the button's aria-label names it. */
export const LIVE_AGENT_LABEL_CLASS = "max-lg:[html:has([data-mobile-action-bar])_&]:sr-only";

export const LIVE_AGENT_ICON_CLASS =
  "mr-2 h-5 w-5 max-lg:[html:has([data-mobile-action-bar])_&]:mr-0";

/** Docked while loading, the chat icon gives way to a spinner (the label is hidden there). */
export const LIVE_AGENT_ICON_LOADING_CLASS =
  "mr-2 h-5 w-5 max-lg:[html:has([data-mobile-action-bar])_&]:hidden";
export const LIVE_AGENT_SPINNER_CLASS =
  "hidden animate-spin max-lg:[html:has([data-mobile-action-bar])_&]:block";

/** Docked after a failed load, an alert dot shows that tapping retries. */
export const LIVE_AGENT_FAILED_DOT_CLASS =
  "pointer-events-none absolute right-1.5 top-1.5 hidden size-2.5 rounded-full bg-destructive ring-2 ring-background max-lg:[html:has([data-mobile-action-bar])_&]:block";
