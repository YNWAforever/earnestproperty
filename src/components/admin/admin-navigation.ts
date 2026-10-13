// Presentation metadata only. admin-nav-roles.ts remains the sole role registry.
export type AdminNavItem = {
  to: string;
  label: string;
  icon: string;
  activeExact: boolean;
  attention?: "leads" | "inbox";
};
export type AdminNavGroup = { id: string; label: string; items: readonly AdminNavItem[] };

export const ADMIN_NAV_GROUPS = [
  {
    id: "daily",
    label: "日常工作",
    items: [
      { to: "/admin", label: "總覽", icon: "overview", activeExact: true },
      {
        to: "/admin/leads",
        label: "客戶查詢",
        icon: "leads",
        activeExact: true,
        attention: "leads",
      },
      {
        to: "/admin/whatsapp",
        label: "WhatsApp 收件匣",
        icon: "chat",
        activeExact: true,
        attention: "inbox",
      },
      { to: "/admin/leads/command-center", label: "跟進工作台", icon: "work", activeExact: true },
      { to: "/admin/listings", label: "樓盤管理", icon: "property", activeExact: false },
      { to: "/admin/transactions", label: "成交管理", icon: "transaction", activeExact: false },
    ],
  },
  {
    id: "management",
    label: "管理與推廣",
    items: [
      { to: "/admin/analytics", label: "營運與轉換", icon: "overview", activeExact: true },
      { to: "/admin/blasts", label: "推廣活動", icon: "campaign", activeExact: true },
      { to: "/admin/segments", label: "客戶分群", icon: "segments", activeExact: true },
      { to: "/admin/cms", label: "內容中心", icon: "content", activeExact: true },
      { to: "/admin/estates", label: "屋苑管理", icon: "estate", activeExact: false },
      { to: "/admin/whatsapp-links", label: "WhatsApp 來源連結", icon: "chat", activeExact: true },
    ],
  },
  {
    id: "settings",
    label: "設定與處理問題",
    items: [
      { to: "/admin/team", label: "團隊成員", icon: "team", activeExact: true },
      { to: "/admin/agents", label: "經紀檔案", icon: "agent", activeExact: false },
      {
        to: "/admin/whatsapp-settings",
        label: "WhatsApp 接收設定",
        icon: "chat",
        activeExact: true,
      },
      { to: "/admin/property-sync", label: "盤源同步", icon: "property", activeExact: true },
      { to: "/admin/operations", label: "系統營運", icon: "operations", activeExact: true },
    ],
  },
] as const satisfies readonly AdminNavGroup[];
