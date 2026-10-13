// Layout evidence uses the existing owned ports, never a real database or provider.
export * from "../daily-work/synthetic-api";
export {
  fetchAdminEstateOptions,
  fetchAdminTransaction,
  saveAdminTransaction,
} from "../leave-guards/synthetic-api";

export {
  fetchAdminDistrictOptions,
  saveAdminProperty,
} from "../property-maintenance/synthetic-api";
export {
  fetchTransactionPerformance,
  saveTransactionPerformance,
  searchTransactionAttributionOptions,
  saveAdminFaq,
  deleteAdminFaq,
} from "../leave-guards/synthetic-api";
import { estate, article } from "../leave-guards/synthetic-api";
import type { AdminAgentProfileRow } from "../../../src/lib/neon/admin-data.types";
export const agent: AdminAgentProfileRow = {
  id: "20000000-0000-4000-8000-000000000001",
  auth_user_id: null,
  email: null,
  name_zh: "合成代理甲",
  name_en: "Synthetic Agent",
  job_title: "物業顧問",
  phone: null,
  whatsapp: null,
  licence_no: "E-123456",
  avatar_url: null,
  branch: "測試分行",
  branch_id: null,
  bio: "合成公開簡介",
  specialties: [],
  served_estate_slugs: [],
  public_slug: "synthetic-agent",
  show_on_website: false,
  display_order: 1,
  active: true,
  created_at: null,
  updated_at: null,
};
export const fetchAdminAgentEditorContext = async () => ({
  canManageIdentity: window.dailyWorkFixture.role === "admin",
});
export const fetchAdminAgentProfile = async () => structuredClone(agent);
export const fetchAdminBranches = async () => [];
export const saveAdminAgentProfile = async () => {
  throw Error("Agent writes are outside this geometry fixture");
};
export const fetchAdminCms = async () => ({
  estates: [estate],
  articles: [article],
  faqs: [],
  videos: [],
  media: [],
});

export {
  checkAdminFaqConflicts,
  fetchAdminAiKnowledgeStatus,
  rebuildAdminAiKnowledge,
  restoreAdminFaq,
  saveAdminCmsVideo,
  updateAdminMediaAsset,
} from "../leave-guards/synthetic-api";
import { fetchAdminPage as dailyPage } from "../daily-work/synthetic-api";
import {
  fetchAdminPage as cmsPage,
  fetchAdminTransaction as transaction,
} from "../leave-guards/synthetic-api";
import { fetchAdminAgents as baseAgents } from "../daily-work/synthetic-api";
import { fetchAdminAgents as mappingAgents } from "../property-maintenance/synthetic-staff";
import type { CommandCenterData, AdminCrmSegmentRow } from "../../../src/lib/neon/admin-data.types";
export const fetchAdminAgentProfiles = async () => [structuredClone(agent)];
export const fetchAdminAgents = () =>
  location.pathname.includes("whatsapp-settings") ? mappingAgents() : baseAgents();
export const fetchAdminTransactionsFiltered = async () => [
  await transaction({ data: { id: "70000000-0000-4000-8000-0000000000aa" } }),
];
export const fetchAdminPage = (input: Parameters<typeof dailyPage>[0]) =>
  ["estates", "articles", "faqs", "videos", "media"].includes(input.data.resource)
    ? cmsPage(input)
    : dailyPage(input);
export const fetchCommandCenter = async (): Promise<CommandCenterData> => ({
  rows: [
    {
      lead_id: "40000000-0000-4000-8000-000000000001",
      contact_id: null,
      name: "合成跟進客戶",
      phone: null,
      email: null,
      stage: "new",
      intent: "buyer",
      budget_min: 5000000,
      budget_max: 8000000,
      preferred_estates: [],
      assigned_agent_id: null,
      assigned_agent_name: null,
      lead_score: null,
      urgency: null,
      timeline: null,
      budget_band: null,
      summary: null,
      next_best_action: null,
      last_analyzed_at: null,
      has_overdue_followup: false,
      next_followup_due_at: null,
      last_activity_at: null,
      handoff_status: null,
      handoff_at: null,
      whatsapp: { linked: false, blockedReason: "NO_PHONE" },
      priority: { bucket: 4, reasonCode: "NEW_UNASSIGNED_NEEDS_ANALYSIS" },
    },
  ],
  kpis: { hot: 0, overdue: 0, unassigned: 1, handoffs: 0, whatsapp_blocked: 1 },
  generated_at: "2026-10-13T00:00:00Z",
  woztell_enabled: false,
});
export const fetchCommandCenterInBackground = fetchCommandCenter;
export const fetchAdminCrmSegments = async (): Promise<AdminCrmSegmentRow[]> => [
  {
    id: "80000000-0000-4000-8000-000000000001",
    name: "合成客戶分群",
    description: null,
    natural_language_prompt: "測試條件",
    structured_filters: {},
    status: "draft",
    created_at: "2026-10-13T00:00:00Z",
    updated_at: "2026-10-13T00:00:00Z",
    members: 0,
    eligible_members: 0,
    has_audience: false,
  },
];
const outsideGeometry = async () => {
  throw Error("Segment mutation/model calls are outside geometry fixture");
};
export const createAdminAudienceFromSegment = outsideGeometry;
export const materializeAdminCrmSegment = outsideGeometry;
export const previewAdminCrmSegment = outsideGeometry;
export const saveAdminCrmSegment = outsideGeometry;

export {
  getWhatsappStaffChannels,
  retireWhatsappStaffChannel,
  saveReviewedWhatsappStaffChannel,
} from "../property-maintenance/synthetic-staff";

export const changeStaffActive = outsideGeometry;
export const changeStaffDutyManager = outsideGeometry;
export const changeStaffRoles = outsideGeometry;
export const inviteStaffMember = outsideGeometry;
export const linkStaffIdentity = outsideGeometry;
export const resendStaffInvitation = outsideGeometry;
export const sendStaffPasswordReset = outsideGeometry;
export const getAdminTeamMember = async (): Promise<AdminTeamMemberDetail> => ({
  member: (await listAdminTeam()).members[0],
  identity: { authUserLinked: true, account: "linked" },
  ownership: { counts: { inquiries: 1 }, total: 1 },
  latestOperation: { action: null, state: null, safeErrorCode: null, retryAfter: null },
  recentActivity: [],
  version: "2026-10-13T00:00:00Z",
});

import type { AdminTeamList, AdminTeamMemberDetail } from "../../../src/lib/neon/admin-team.types";
import { listAdminTeam as dailyTeam } from "../daily-work/synthetic-api";
export const listAdminTeam = async (): Promise<AdminTeamList> => {
  const base = await dailyTeam();
  return {
    ...base,
    members: base.members.map((member) => ({
      ...member,
      email: "synthetic-team@example.invalid",
      roles: ["agent"],
      accessState: "active",
      isDutyManager: false,
      invitationState: "sent",
      invitationRetryAfter: null,
      invitationExpiresAt: null,
      createdAt: "2026-10-13T00:00:00Z",
      updatedAt: "2026-10-13T00:00:00Z",
      onboarding: {
        steps: {
          staffActive: "ready",
          invitation: "not_required",
          emailVerified: "ready",
          identityBound: "ready",
          roleBranch: "ready",
          inboxAssignment: "unknown",
          inboxPrivateNote: "unknown",
          staffPhone: "not_required",
        },
        attentionReasons: [],
      },
    })),
  };
};
