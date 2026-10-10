/**
 * FX-17a G-12: the one place admin terms and status labels are defined. A term or a status has
 * one zh-HK label here and every screen imports it, so two screens can never name the same thing
 * two ways. `glossary.test.ts` fails when a map is redefined elsewhere or a rejected variant
 * comes back. Type-only imports keep this client-safe.
 */
import type { StaffAccessRole } from "@/lib/neon/admin-data.types";
import type { CmsRevisionSummary } from "@/lib/neon/admin-cms.types";
import type { JobStatus } from "@/lib/admin/operations/operations-types";

export { JOB_TYPE_LABELS, JOB_FAILURE_REASONS } from "@/lib/admin/job-labels";

/** The approved terms. Screens use these words; the Task 8 copy table is the source. */
export const ADMIN_TERMS = {
  listings: "樓盤管理",
  sourceLinks: "WhatsApp 來源連結",
  editSourceLink: "編輯來源連結",
  campaigns: "推廣活動",
  campaignsDescription: "推廣活動：只用已審批範本、只發給已同意接收的客戶。",
  crmLead: "客戶查詢",
  enquiryRecord: "查詢紀錄",
  unassigned: "未指派",
  leadOwner: "負責代理",
  publish: "發布",
  websiteChat: "問樓助手",
  inbox: "WhatsApp 收件匣",
} as const;

export type LeadStage =
  | "new"
  | "contacted"
  | "viewing"
  | "negotiating"
  | "closed_won"
  | "closed_lost";

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: "新查詢",
  contacted: "已聯絡",
  viewing: "已約睇樓",
  negotiating: "商議中",
  closed_won: "已成交",
  closed_lost: "已結束（未成交）",
};

export const LEAD_SOURCE_LABELS: Record<string, string> = {
  website: "網站",
  live_agent: ADMIN_TERMS.websiteChat,
  whatsapp: "WhatsApp",
  phone: "電話",
  referral: "轉介",
  walk_in: "到店",
  manual_forward: "人工轉交",
};

export const CONVERSATION_STATUS_LABELS: Record<string, string> = {
  open: "開啟",
  pending: "待跟進",
  closed: "已關閉",
};

export const PROPERTY_STATUS_LABELS: Record<string, string> = {
  active: "公開",
  draft: "草稿",
  offline: "已下架",
  inactive: "來源已下架",
  sold: "已售",
  rented: "已租",
};

export const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  review: "待審核",
  scheduled: "已排期",
  queued: "已排隊",
  sending: "發送中",
  completed: "已完成",
  failed: "失敗",
  cancelled: "已取消",
};

export const CMS_REVISION_STATE_LABELS: Record<CmsRevisionSummary["state"], string> = {
  draft: "草稿",
  published: "已發布",
  superseded: "已被取代",
  archived: "已封存",
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  queued: "等候中",
  running: "執行中",
  succeeded: "成功",
  failed: "失敗",
  cancelled: "已取消",
};

export const HEALTH_STATUS_LABELS: Record<string, string> = {
  healthy: "正常",
  degraded: "需要留意",
  failed: "故障",
};

export const ASSIGNMENT_STATE_LABELS: Record<string, string> = {
  pending: "等候處理",
  executing: "正在要求分派",
  unknown: "結果待核實",
  confirmed: "已確認",
  failed: "分派失敗",
  blocked: "已阻擋",
  superseded: "已由較新要求取代",
};

export const PLACEMENT_SOURCE_LABELS: Record<string, string> = {
  website: "網站",
  "28hse": "28Hse",
  youtube: "YouTube",
  unknown: "來源未記錄",
  other: "其他",
};

export const ROLE_LABELS: Record<StaffAccessRole, string> = {
  admin: "管理員",
  manager: "經理",
  agent: "代理",
  viewer: "只讀同事",
};
