import { createContext, useContext } from "react";

import type { StaffSession, StaffSessionDenialReason } from "@/lib/neon/admin-data.types";

/**
 * The signed-in user's staff identity as the server resolved it, provided by
 * AdminShell. `null` while it is still loading or when the lookup itself
 * failed -- consumers must treat null as "unknown", never as "denied".
 */
export const StaffSessionContext = createContext<StaffSession | null>(null);

export function useStaffSession() {
  return useContext(StaffSessionContext);
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
