import { useEffect, useSyncExternalStore } from "react";

import { fetchStaffSession } from "@/lib/neon/admin-data";
import type { StaffSession, StaffSessionDenialReason } from "@/lib/neon/admin-data.types";

export type StaffSessionSnapshot = {
  userId: string | null;
  /** null = not known yet, or the lookup itself failed. Never treat as denied. */
  session: StaffSession | null;
  loading: boolean;
};

const EMPTY: StaffSessionSnapshot = { userId: null, session: null, loading: false };

/**
 * The signed-in user's staff identity as the server resolved it, held in a
 * small shared store rather than React context.
 *
 * Context was the first attempt and it failed in production: the Provider
 * lived inside AdminShell, but /admin/team reads the session in the component
 * that RENDERS AdminShell -- above the Provider -- so it always saw null,
 * canManage was false for every admin, and 連結帳戶 / 邀請成員 / 變更角色 all
 * disappeared. A store can be read from any component regardless of tree
 * position, and one lookup per signed-in user is shared by the shell and the
 * page instead of being repeated on every page mount.
 */
export function createStaffSessionStore(fetcher: () => Promise<StaffSession>) {
  let state: StaffSessionSnapshot = EMPTY;
  let inFlight: { userId: string; promise: Promise<StaffSession | null> } | null = null;
  const listeners = new Set<() => void>();

  function publish(next: StaffSessionSnapshot) {
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

  function reset() {
    inFlight = null;
    publish(EMPTY);
  }

  function refresh(userId: string): Promise<StaffSession | null> {
    if (inFlight?.userId === userId) return inFlight.promise;
    // Keep the previous answer visible while re-checking: a denial card that
    // blanked on every 重新檢查 would look as if the check had cleared it.
    publish({ userId, session: state.userId === userId ? state.session : null, loading: true });
    const promise = fetcher()
      .then((session): StaffSession | null => session)
      .catch((): StaffSession | null => null)
      .then((session) => {
        if (inFlight?.promise === promise) inFlight = null;
        // The user may have signed out (reset) or changed while this was in
        // flight; only the current user's answer is published.
        if (state.userId === userId) publish({ userId, session, loading: false });
        return session;
      });
    inFlight = { userId, promise };
    return promise;
  }

  function useStaffSession(userId: string | null) {
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    useEffect(() => {
      if (!userId) {
        if (state.userId !== null) reset();
        return;
      }
      if (state.userId !== userId || (state.session === null && !state.loading)) {
        void refresh(userId);
      }
    }, [userId]);
    const current = snapshot.userId === userId ? snapshot : EMPTY;
    return {
      session: current.session,
      loading: current.loading,
      refresh: () => (userId ? refresh(userId) : Promise.resolve(null)),
    };
  }

  return { subscribe, getSnapshot, reset, refresh, useStaffSession };
}

export const staffSessionStore = createStaffSessionStore(fetchStaffSession);

/** Read (and lazily load) the signed-in user's staff session from any component. */
export function useStaffSession(userId: string | null) {
  return staffSessionStore.useStaffSession(userId);
}

/**
 * What to tell a signed-in Neon Auth user whose account cannot use the admin.
 * Each reason names the next step, because the generic "no permission" these
 * users saw before gave neither them nor the admin anything to act on.
 */
export function staffSessionDenialCopy(reason: StaffSessionDenialReason): {
  title: string;
  description: string;
} {
  if (reason === "staff-email-unverified") {
    return {
      title: "帳戶尚未連結職員記錄",
      description:
        "你已成功登入，但登入電郵尚未完成驗證，系統未有自動連結你的職員記錄。請聯絡管理員在「團隊成員」的成員詳情按「連結帳戶」，連結後即可使用後台。",
    };
  }
  if (reason === "unauthorized") {
    return {
      title: "登入狀態已失效",
      description: "伺服器無法確認你的登入狀態，請登出後重新登入。",
    };
  }
  return {
    title: "此帳戶不是職員帳戶",
    description:
      "你已登入，但系統找不到使用此電郵的啟用職員記錄。請聯絡管理員在「團隊成員」邀請你，並確認邀請所用的電郵與你的登入電郵相同。",
  };
}
