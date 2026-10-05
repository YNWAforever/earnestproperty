import { useEffect, useSyncExternalStore } from "react";

import { MIN_VISIBLE_INTERVAL_MS, useVisibleInterval } from "@/lib/admin/use-visible-interval";
import { BACKGROUND_READ_TIMEOUT_MS, withTimeout } from "@/lib/admin/with-timeout";
import { fetchAdminAttentionCounts } from "@/lib/neon/admin-data";
import type { AdminAttentionCounts } from "@/lib/neon/admin-data.types";

/** The nav badges and the tab title refresh once a minute while the tab is visible. */
export const ATTENTION_POLL_MS = MIN_VISIBLE_INTERVAL_MS; // 60_000

export type AttentionKind = "leads" | "inbox";

export type AdminAttentionSnapshot = {
  /** Whose counts these are: the signed-in user, staff record and roles, serialised. */
  identity: string | null;
  counts: AdminAttentionCounts | null;
  checkedAt: number | null;
};

const EMPTY: AdminAttentionSnapshot = { identity: null, counts: null, checkedAt: null };

function nonNegative(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * 客戶查詢 shows the distinct open leads that are unassigned or stale-new (a lead that is both
 * counts once), WhatsApp 收件匣 the unanswered conversations, and the tab title their sum.
 */
export function attentionBadges(counts: AdminAttentionCounts | null): {
  leads: number;
  inbox: number;
  total: number;
} {
  if (!counts) return { leads: 0, inbox: 0, total: 0 };
  const leads = nonNegative(counts.leadsNeedingAttention);
  const inbox = nonNegative(counts.unansweredConversations);
  return { leads, inbox, total: leads + inbox };
}

export function inboxBadgeDescription(counts: AdminAttentionCounts): string {
  return `${counts.unansweredConversations} 個對話待回覆`;
}

export function leadsBadgeDescription(counts: AdminAttentionCounts): string {
  return `未指派 ${counts.unassignedLeads} 宗；逾 2 小時未跟進的新查詢 ${counts.staleNewLeads} 宗`;
}

/** One nav entry's badge, or null when there is nothing waiting (no badge, no description). */
export function attentionBadge(
  kind: AttentionKind,
  counts: AdminAttentionCounts | null,
): { count: number; description: string } | null {
  if (!counts) return null;
  const count = attentionBadges(counts)[kind];
  if (count <= 0) return null;
  return {
    count,
    description: kind === "leads" ? leadsBadgeDescription(counts) : inboxBadgeDescription(counts),
  };
}

export function badgeText(count: number): string {
  return count > 99 ? "99+" : String(count);
}

const TITLE_PREFIX = /^\(\d+\+?\) /;

/** Strips any leading /^\(\d+\+?\) / and adds `(${badgeText(total)}) ` when total > 0. */
export function withAttentionTitle(title: string, total: number): string {
  const base = title.replace(TITLE_PREFIX, "");
  return total > 0 ? `(${badgeText(total)}) ${base}` : base;
}

/** A failed read is logged by its error's name only (e.g. TimeoutError), never its message. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

/**
 * The waiting-work counts behind the nav badges and the tab title, shared by every AdminShell
 * (each admin page renders its own) so a page change never repeats a fresh read.
 *
 * - One read in flight per identity; a second refresh joins it.
 * - Counts are published only by a read of the current generation, which `reset()` and every
 *   change of identity end: one account's counts are never shown to another, a new identity
 *   starts empty at once, and an overtaken or abandoned read can never overwrite newer counts.
 * - A failed or timed-out read keeps the last counts and never throws or alerts. It logs one
 *   constant tag and the error's name, never counts, a message or a response body.
 */
export function createAdminAttentionStore(
  fetcher: () => Promise<AdminAttentionCounts>,
  now: () => number = () => Date.now(),
) {
  let state: AdminAttentionSnapshot = EMPTY;
  let generation = 0;
  let inFlight: { generation: number; promise: Promise<void> } | null = null;
  const listeners = new Set<() => void>();

  function publish(next: AdminAttentionSnapshot) {
    state = next;
    for (const listener of listeners) listener();
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function getSnapshot() {
    return state;
  }

  function refresh(identity: string): Promise<void> {
    if (state.identity !== identity) {
      generation += 1;
      publish({ identity, counts: null, checkedAt: null });
    }
    if (inFlight?.generation === generation) return inFlight.promise;
    const readGeneration = generation;
    // The executor runs the fetcher synchronously; a synchronous throw becomes a rejection.
    const request = new Promise<AdminAttentionCounts>((resolve) => resolve(fetcher()));
    const promise: Promise<void> = request
      .then(
        (counts) => {
          if (readGeneration === generation) publish({ identity, counts, checkedAt: now() });
        },
        (error: unknown) => {
          // Keep the last counts. The message is not logged: it may quote customer data.
          console.warn("ADMIN_ATTENTION_READ_FAILED", errorName(error));
        },
      )
      .finally(() => {
        if (inFlight?.promise === promise) inFlight = null;
      });
    inFlight = { generation: readGeneration, promise };
    return promise;
  }

  function refreshIfStale(identity: string, maxAgeMs: number = ATTENTION_POLL_MS): Promise<void> {
    if (
      state.identity === identity &&
      state.checkedAt !== null &&
      now() - state.checkedAt < maxAgeMs
    ) {
      return Promise.resolve();
    }
    return refresh(identity);
  }

  function reset() {
    // A read still in flight belongs to the old generation, so it can no longer publish.
    generation += 1;
    if (state !== EMPTY) publish(EMPTY);
  }

  return { subscribe, getSnapshot, refresh, refreshIfStale, reset };
}

export const adminAttentionStore = createAdminAttentionStore(() =>
  withTimeout(fetchAdminAttentionCounts(), BACKGROUND_READ_TIMEOUT_MS),
);

/**
 * The signed-in staff member's waiting-work counts, or null while unknown. Pass null for anyone
 * who must not read them (signed out, staff lookup pending, viewer): that clears the counts and
 * sends no request. Refreshes once a minute while the tab is visible.
 */
export function useAdminAttention(identity: string | null): AdminAttentionCounts | null {
  const snapshot = useSyncExternalStore(
    adminAttentionStore.subscribe,
    adminAttentionStore.getSnapshot,
    adminAttentionStore.getSnapshot,
  );
  useEffect(() => {
    if (identity === null) {
      adminAttentionStore.reset();
      return;
    }
    void adminAttentionStore.refreshIfStale(identity);
  }, [identity]);
  useVisibleInterval(() => {
    return identity ? adminAttentionStore.refresh(identity) : undefined;
  }, ATTENTION_POLL_MS);
  return snapshot.identity === identity ? snapshot.counts : null;
}
