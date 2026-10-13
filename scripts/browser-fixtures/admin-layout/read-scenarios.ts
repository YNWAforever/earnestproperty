// These controlled read outcomes are presentation evidence only, never Auth/ACL evidence.
export * from "./synthetic-api";
import * as base from "./synthetic-api";
import { read } from "./read-control";
export const fetchAdminPage = read("page", base.fetchAdminPage, (value) => ({
  ...value,
  rows: [],
  total: 0,
  nextCursor: null,
}));
export const fetchAdminCms = read("cms", base.fetchAdminCms, (value) => ({
  ...value,
  estates: [],
  articles: [],
  faqs: [],
  videos: [],
  media: [],
}));
export const fetchAdminAgentProfiles = read(
  "agent-profiles",
  base.fetchAdminAgentProfiles,
  () => [],
);
export const fetchAdminAgentProfile = read("agent-profile", base.fetchAdminAgentProfile);
export const fetchAdminAgentEditorContext = read(
  "agent-context",
  base.fetchAdminAgentEditorContext,
);
export const fetchAdminAgents = read("agents", base.fetchAdminAgents);
export const fetchAdminEstateOptions = read("estate-options", base.fetchAdminEstateOptions);
export const fetchAdminTransactionsFiltered = read(
  "transactions",
  base.fetchAdminTransactionsFiltered,
  () => [],
);
export const fetchAdminTransaction = read("transaction", base.fetchAdminTransaction);
export const fetchAdminCrmSegments = read("segments", base.fetchAdminCrmSegments, () => []);
export const fetchAdminCampaigns = read("campaigns", base.fetchAdminCampaigns, () => []);
export const fetchAdminBlastOptions = read("campaign-options", base.fetchAdminBlastOptions);
export const listAdminTeam = read("team", base.listAdminTeam, (value) => ({
  ...value,
  members: [],
  counts: { active: 0, invited: 0, suspended: 0, attention: 0 },
  nextCursor: null,
}));
export const fetchAdminOverview = read("overview", base.fetchAdminOverview, (value) => ({
  ...value,
  publicProperties: 0,
  publicOffers: 0,
  openLeads: 0,
  openConversations: 0,
  contacts: 0,
}));
export const fetchCommandCenter = read("command-center", base.fetchCommandCenter, (value) => ({
  ...value,
  rows: [],
  kpis: { hot: 0, overdue: 0, unassigned: 0, handoffs: 0, whatsapp_blocked: 0 },
}));

export const fetchAdminDistrictOptions = read("district-options", base.fetchAdminDistrictOptions);
