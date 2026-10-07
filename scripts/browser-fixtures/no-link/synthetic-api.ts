// Test-only API model. This is presentation evidence, not server ACL or provider proof.
import { syntheticOutboundMessages } from "./synthetic-outbound";
export {
  sendAdminConversationReply,
  sendAdminConversationTemplate,
  fetchAdminOutboundIntent,
  fetchAdminOutboundReservation,
} from "./synthetic-outbound";
import {
  validateForwardedEnquiry,
  validateLeadContactUpdate,
  type ForwardedEnquiryInput,
  type LeadContactUpdateInput,
} from "../../../src/lib/whatsapp-enquiries/forwarded-enquiries";
export const actor = sessionStorage.getItem("no-link-fixture-actor") ?? "agent-a";
export const ids = {
  a: "10000000-0000-4000-8000-000000000001",
  b: "10000000-0000-4000-8000-000000000002",
  private: "10000000-0000-4000-8000-000000000003",
  staff: "20000000-0000-4000-8000-000000000001",
  staffB: "20000000-0000-4000-8000-000000000002",
  enquiry: "30000000-0000-4000-8000-000000000001",
  enquiryB: "30000000-0000-4000-8000-000000000002",
};
const now = new Date().toISOString();
const inboundAt =
  sessionStorage.getItem("no-link-fixture-window") === "expired"
    ? new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    : now;
const message = (n: number, id: string) => ({
  id: `${id.slice(0, 24)}${String(n).padStart(12, "0")}`,
  direction: "inbound",
  message_type: "text",
  text: `合成訊息 ${n}：碧堤半島樓盤查詢，請提供資料。`.repeat(4),
  status: "received",
  error: null,
  created_at: new Date(Date.now() - (31 - n) * 1000).toISOString(),
});
const row = (id: string, name: string, external: string) => ({
  id,
  name,
  customer_display_name: name,
  status: "open",
  phone: null,
  contact_id: null,
  assigned_agent_id: ids.staff,
  woztell_member_id: "synthetic-member",
  last_message_at: now,
  last_inbound_at: inboundAt,
  opted_out_whatsapp: false,
  can_clear_opt_out: false,
  last_text: "合成樓盤查詢",
  last_direction: "inbound",
  awaiting_human_response: true,
  public_listing_no: id === ids.a ? "A074714" : "A074715",
  external_listing_id: external,
  source_label: "28Hse",
  requested_staff_name: "合成同事甲",
  confirmed_owner_name: "合成同事甲",
  next_action: "reply",
  capabilities: { canReply: true, canCorrect: false },
  messages: Array.from({ length: 30 }, (_, n) => message(n + 1, id)),
});
const rows = [row(ids.a, "合成客戶甲", "4033349"), row(ids.b, "合成客戶乙", "4033350")];
const state = {
  calls: [] as { name: string; input: unknown }[],
  membershipMode: "ok",
  membershipRole: actor === "manager" ? "manager" : "agent",
  membershipBinding: actor === "agent-b" ? ids.staffB : ids.staff,
  pendingMembership: [] as { release: () => void }[],
  refreshMembership: async (
    _mode = "ok",
    _role = actor === "manager" ? "manager" : "agent",
    _binding = ids.staff,
  ) => {},
  pushInbound: (_id: string, _text: string) => {},
  // "pending" holds every conversations-list read (answering with the rows as they were when it
  // was asked) until the test calls the releases in pendingList; "failure" makes it throw.
  listMode: "ok" as "ok" | "pending" | "failure",
  pendingList: [] as (() => void)[],
  // With sessionStorage no-link-fixture-agents=error, the staff list read waits here, then fails.
  pendingAgents: [] as (() => void)[],
  // Rows per conversations-list page; null puts every row on one page.
  listPageSize: null as number | null,
  templateFailure: false,
  assignmentFailure: false,
  delayDetail: false,
  failOverview: false,
  failOverviewDenied: false,
  attentionMode: "ok" as "ok" | "failure" | "pending",
  attentionCounts: {
    unansweredConversations: 2,
    unassignedLeads: 0,
    staleNewLeads: 0,
    leadsNeedingAttention: 0,
  },
  pendingAttention: [] as (() => void)[],
  todayTasks: [
    {
      kind: "conversation" as const,
      id: ids.a,
      title: "合成客戶甲",
      waitingSince: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    },
    {
      // Resolves in the daily-work fixture's fetchAdminLead.
      kind: "lead" as const,
      id: "40000000-0000-4000-8000-000000000002",
      title: "每日工作合成查詢1",
      waitingSince: new Date(Date.now() - 150 * 60 * 1000).toISOString(),
    },
  ],
  releaseLateDetail: null as null | (() => void),
  forwardMode: "ok",
  releaseForward: null as null | (() => void),
  contactMode: "ok",
  releaseContact: null as null | (() => void),
  contactReadFailure: false,
  relatedReadFailure: sessionStorage.getItem("no-link-fixture-related-error") === "true",
  resolutionMode: "ok",
  releaseResolution: null as null | (() => void),
  resolutionReadFailure: sessionStorage.getItem("no-link-fixture-resolution-error") === "true",
  retiredCandidate: false,
  aiMode: sessionStorage.getItem("no-link-fixture-ai") ?? "empty",
  pendingAi: [] as {
    conversationId: string;
    ordinal: number;
    finish: (outcome: string) => void;
  }[],
};
Object.assign(window, {
  noLinkFixture: { ...state, ids, actor, lastMessage: rows[0].messages.at(-1)!.text },
});
const fixture = () => (window as unknown as { noLinkFixture: typeof state }).noLinkFixture;
fixture().refreshMembership = async (
  mode = "ok",
  role = actor === "manager" ? "manager" : "agent",
  binding = ids.staff,
) => {
  Object.assign(fixture(), {
    membershipMode: mode,
    membershipRole: role,
    membershipBinding: binding,
  });
  const { staffSessionStore } = await import("../../../src/components/admin/staff-session");
  if (mode === "delayed") {
    void staffSessionStore.refresh(actor);
    return;
  }
  await staffSessionStore.refresh(actor);
};
// A customer message arriving while the page is open: the next list read returns it.
fixture().pushInbound = (id: string, text: string) => {
  const target = rows.find((r) => r.id === id);
  if (!target) throw Error("Unknown synthetic conversation");
  const created_at = new Date().toISOString();
  Object.assign(target, {
    last_text: text,
    last_message_at: created_at,
    last_inbound_at: created_at,
    last_direction: "inbound",
  });
  target.messages.push({ ...message(target.messages.length + 1, id), text, created_at });
};
const call = (name: string, input?: unknown) => fixture().calls.push({ name, input });
function readable(id: string) {
  return ["agent-a", "manager"].includes(actor) && rows.some((r) => r.id === id);
}
function deny() {
  throw Error("沒有查看此對話的權限。");
}
export async function fetchStaffSession() {
  call("staffSession");
  if (fixture().membershipMode === "delayed")
    await new Promise<void>((release) => fixture().pendingMembership.push({ release }));
  return actor === "viewer" || fixture().membershipMode === "denied"
    ? { status: "denied", reason: "not-staff" }
    : {
        status: "ok",
        roles: [fixture().membershipRole],
        staffId: fixture().membershipBinding,
      };
}
export async function fetchAdminAgents() {
  if (sessionStorage.getItem("no-link-fixture-agents") === "error") {
    await new Promise<void>((release) => fixture().pendingAgents.push(release));
    throw Error("合成同事名單讀取失敗");
  }
  return [
    { id: ids.staff, name: "合成同事甲", email: null, roles: ["agent"], active: true },
    { id: ids.staffB, name: "合成同事乙", email: null, roles: ["agent"], active: true },
  ];
}
export async function fetchAdminWoztellStatus() {
  return { woztellEnabled: true };
}
export async function fetchAdminWhatsappTemplates() {
  call("templates");
  if (fixture().templateFailure || sessionStorage.getItem("no-link-fixture-templates") === "error")
    throw Error("合成範本讀取失敗");
  return sessionStorage.getItem("no-link-fixture-reply-template") === "true"
    ? [
        {
          id: "70000000-0000-4000-8000-000000000001",
          element_name: "synthetic_reply",
          language_code: "zh_HK",
          components: [],
          status: "active",
        },
      ]
    : [];
}
export async function fetchAdminPage({
  data,
}: {
  data: { resource: string; conversationId?: string; q?: string; cursor?: string; stage?: string };
}) {
  call("page", data);
  if (data.resource === "leads") {
    if (sessionStorage.getItem("no-link-fixture-overview")) {
      const items = ["new", "contacted", "closed_won"].map((stage, n) => ({
        id: `40000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`,
        name: "總覽合成查詢" + n,
        stage,
        intent: "buyer",
        source: "website",
        created_at: now,
        assigned_agent_id: ids.staff,
        phone: null,
        email: null,
        opt_in_whatsapp: false,
      }));
      const filtered = items.filter(
        (r) => data.stage !== "open" || !["closed_won", "closed_lost"].includes(r.stage),
      );
      return { rows: filtered, total: filtered.length, nextCursor: null };
    }
    const leads = forwardedRecords().filter(canReadForward).map(forwardLead);
    return { rows: leads, total: leads.length, nextCursor: null };
  }
  if (data.resource === "conversations") {
    const allowed = ["agent-a", "manager"].includes(actor)
      ? rows.filter(
          (r) =>
            !data.q ||
            [r.name, r.external_listing_id, r.public_listing_no].some((s) => s.includes(data.q!)),
        )
      : [];
    const size = fixture().listPageSize ?? Math.max(allowed.length, 1);
    const offset = Number(data.cursor ?? 0);
    const page = {
      rows: allowed.slice(offset, offset + size).map((r) => ({ ...r, messages: undefined })),
      total: allowed.length,
      nextCursor: offset + size < allowed.length ? String(offset + size) : null,
    };
    if (fixture().listMode === "pending")
      await new Promise<void>((release) => fixture().pendingList.push(release));
    if (fixture().listMode === "failure") throw Error("合成對話列表讀取失敗");
    return page;
  }
  if (data.resource === "messages") {
    if (!readable(data.conversationId!)) return deny();
    return {
      rows: [
        ...rows.find((r) => r.id === data.conversationId)!.messages,
        ...syntheticOutboundMessages(data.conversationId!),
      ],
      nextCursor: null,
      newestCursor: "synthetic-newest",
    };
  }
  throw Error("Unexpected synthetic resource");
}
export async function fetchAdminConversation({ data }: { data: { id: string } }) {
  call("detail", data);
  if (fixture().delayDetail && data.id === ids.a) {
    await new Promise<void>((done) => {
      fixture().releaseLateDetail = done;
    });
  }
  return readable(data.id) ? { ...rows.find((r) => r.id === data.id)!, messages: [] } : null;
}
export async function fetchAdminConversationAiAssist({
  data,
}: {
  data: { conversationId: string };
}) {
  call("ai-read", data);
  const ordinal = fixture().calls.filter(
    (c) => c.name === "ai-read" && (c.input as typeof data)?.conversationId === data.conversationId,
  ).length;
  let mode = fixture().aiMode;
  if (mode === "delay") {
    mode = await new Promise<string>((finish) => {
      fixture().pendingAi.push({ conversationId: data.conversationId, ordinal, finish });
    });
  }
  if (mode === "error") throw Error("Synthetic AI read unavailable; internal reference hidden");
  if (!readable(data.conversationId)) deny();
  if (mode === "empty") return null;
  const label = data.conversationId === ids.a ? "甲" : "乙";
  return {
    method: "deterministic_rules",
    checkedAt: now,
    summary: `合成${label}規則摘要 ${ordinal}`,
    detectedIntent: "buyer",
    urgency: "normal",
    suggestedReply: `合成${label}規則回覆 ${ordinal}\n請核對樓盤資料。Please verify the listing details.`,
    handoffNote: "合成規則提示，只作草稿。",
  };
}
export async function getWhatsappAssignment({ conversationId }: { conversationId: string }) {
  call("assignment", { conversationId });
  if (fixture().assignmentFailure) throw Error("Synthetic network outage");
  if (!readable(conversationId))
    return { kind: "error", code: "forbidden", requestId: "synthetic-denied" };
  const staffName =
    sessionStorage.getItem("no-link-fixture-names") === "missing" ? null : "合成同事甲";
  return {
    kind: "ok",
    context: {
      proposedStaffId: ids.staff,
      proposedStaffName: staffName,
      proposalReason: "requested_staff",
      confirmed_staff_id: ids.staff,
      confirmed_staff_name: staffName,
      assignment_state: sessionStorage.getItem("no-link-fixture-assignment") ?? "confirmed",
      desired_staff_id: null,
      desired_staff_name: null,
      enquiries: [
        {
          id: conversationId === ids.a ? ids.enquiry : ids.enquiryB,
          property: conversationId === ids.a ? "A074714" : "A074715",
          source: "28Hse",
          dealType: "sale",
          requestedStaffId: ids.staff,
          requestedStaffName: staffName,
          firstResponseAt: null,
          dueAt: null,
          review: sessionStorage.getItem("no-link-fixture-enquiry-review") === "true",
        },
      ],
    },
  };
}
export async function getWhatsappEnquiryQueue() {
  return [];
}
export {
  fetchMyStaffNotifications,
  confirmStaffNotification,
  askStaffNotificationHelp,
} from "./synthetic-staff-work";
function noMutation(name: string, input?: unknown): never {
  call(name, input);
  throw Error("Synthetic fixture forbids mutations");
}
export const updateAdminConversation = (input: unknown) => noMutation("updateConversation", input);
export const runAdminWoztellBackfill = () => noMutation("backfill");
export const setWhatsappMarketingConsent = () => noMutation("consent");
type SyntheticResolution = {
  version: number;
  propertyId: string | null;
  requestedStaffId: string | null;
  ownerStaffId: string | null;
  revisions: unknown[];
};
const resolutionStorage = "no-link-fixture-resolutions";
function resolutionRecords(): Record<string, SyntheticResolution> {
  return JSON.parse(sessionStorage.getItem(resolutionStorage) ?? "{}");
}
function resolutionRecord(inquiryId: string): SyntheticResolution {
  return (
    resolutionRecords()[inquiryId] ?? {
      version: 0,
      propertyId: "40000000-0000-4000-8000-000000000001",
      requestedStaffId: ids.staff,
      ownerStaffId: ids.staff,
      revisions: [],
    }
  );
}
export async function fetchWhatsappEnquiryDetail(inquiryId: string) {
  call("resolutionRead", { inquiryId });
  if (fixture().resolutionReadFailure) throw Error("Synthetic resolution read unavailable");
  if (!["agent-a", "manager"].includes(actor) || ![ids.enquiry, ids.enquiryB].includes(inquiryId))
    return deny();
  const record = resolutionRecord(inquiryId);
  return {
    access: {
      canRead: true,
      canCorrect: actor === "manager",
      canReply: false,
      canExport: actor === "manager",
      historyScope: "enquiry",
    },
    messages: [
      {
        id: inquiryId,
        text:
          inquiryId === ids.enquiry
            ? "本次合成原文甲：碧堤半島 28Hse ID:4033349"
            : "本次合成原文乙：另一盤 ID:4033350",
        createdAt: now,
      },
    ],
    context: {
      inquiryId,
      version: record.version,
      publicListingNo: inquiryId === ids.enquiry ? "A074714" : "A074715",
      associationReview: true,
      providerThreadReview: record.ownerStaffId !== ids.staff,
      propertyId: record.propertyId,
      requestedStaffId: record.requestedStaffId,
      ownerStaffId: record.ownerStaffId,
      references: [
        {
          source: "28hse",
          externalListingId: inquiryId === ids.enquiry ? "4033349" : "4033350",
          dealType: "sale",
        },
      ],
      propertyCandidates: [
        { id: "40000000-0000-4000-8000-000000000001", label: "A074714 · 合成碧堤半島" },
      ],
      requestedStaffCandidates: [{ id: ids.staff, label: "合成同事甲" }],
      ownerCandidates: [
        { id: ids.staff, label: "合成同事甲" },
        ...(fixture().retiredCandidate ? [] : [{ id: ids.staffB, label: "合成同事乙" }]),
      ],
    },
  };
}
export async function correctWhatsappEnquiry(input: {
  inquiryId: string;
  expectedVersion: number;
  propertyId?: string | null;
  requestedStaffId?: string | null;
  ownerStaffId?: string | null;
  reason: string;
}) {
  call("syntheticCorrection", input);
  if (fixture().resolutionMode === "delay")
    await new Promise<void>((done) => {
      fixture().releaseResolution = done;
    });
  const fail = (status: number) => {
    throw Object.assign(Error(status === 409 ? "Synthetic STALE" : "Synthetic forbidden"), {
      status,
    });
  };
  if (actor !== "manager" || fixture().resolutionMode === "forbidden") return fail(403);
  const record = resolutionRecord(input.inquiryId);
  if (
    record.version !== input.expectedVersion ||
    fixture().resolutionMode === "stale" ||
    (fixture().retiredCandidate && input.ownerStaffId === ids.staffB)
  )
    return fail(409);
  for (const key of ["propertyId", "requestedStaffId", "ownerStaffId"] as const)
    if (input[key] !== undefined) record[key] = input[key];
  record.version++;
  record.revisions.push(input);
  const records = resolutionRecords();
  records[input.inquiryId] = record;
  sessionStorage.setItem(resolutionStorage, JSON.stringify(records));
  if (fixture().resolutionMode === "timeout") {
    fixture().resolutionMode = "ok";
    throw Error("Synthetic response lost after correction commit");
  }
  return {
    inquiryId: input.inquiryId,
    version: record.version,
    ownerStaffId: record.ownerStaffId,
    resolution: { propertyId: record.propertyId, requestedStaffId: record.requestedStaffId },
    providerThreadReview: record.ownerStaffId !== ids.staff,
    associationReview: true,
  };
}

// Session-only model for CRM presentation. This deliberately does not claim SQL/auth evidence.
type ForwardRecord = {
  input: ForwardedEnquiryInput;
  actor: string;
  id: string;
  contact?: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string;
    optIn: boolean;
  };
  conversationId?: string;
};
const forwardStorage = "no-link-fixture-forward-records";
function forwardedRecords(): ForwardRecord[] {
  return JSON.parse(sessionStorage.getItem(forwardStorage) ?? "[]");
}
function canReadForward(record: ForwardRecord) {
  const owner = record.input.responsibleStaffId ?? ids.staff;
  return (
    actor === "manager" ||
    (actor === "agent-a" && owner === ids.staff) ||
    (actor === "agent-b" && owner === ids.staffB)
  );
}
function forwardLead(record: ForwardRecord) {
  return {
    id: record.id,
    stage: "new",
    intent: "buyer",
    source: record.contact ? "whatsapp" : "manual_forward",
    name: record.contact?.name ?? null,
    phone: record.contact?.phone ?? null,
    email: record.contact?.email ?? null,
    contact_id: record.contact?.id ?? null,
    opt_in_whatsapp: record.contact?.optIn ?? false,
    budget_min: null,
    budget_max: null,
    note: record.input.note,
    created_at: now,
    assigned_agent_id: record.input.responsibleStaffId ?? ids.staff,
    listing_no: null,
    property_title: null,
    preferred_estates: [],
    activities: record.input.followUpTitle
      ? [
          {
            id: "60000000-0000-4000-8000-000000000001",
            activity_type: "follow_up",
            body: record.input.followUpTitle,
            due_at: record.input.followUpDueAt,
            completed_at: null,
            created_at: now,
            staff_name: "合成負責同事",
          },
        ]
      : [],
  };
}
export async function saveForwardedEnquiry(input: ForwardedEnquiryInput) {
  call("syntheticForward", input);
  const attempts = JSON.parse(sessionStorage.getItem("no-link-fixture-forward-attempts") ?? "[]");
  attempts.push(input);
  sessionStorage.setItem("no-link-fixture-forward-attempts", JSON.stringify(attempts));
  const valid = validateForwardedEnquiry(input);
  if (!["agent-a", "manager"].includes(actor)) return deny();
  if (actor !== "manager" && valid.responsibleStaffId && valid.responsibleStaffId !== ids.staff)
    return deny();
  if (fixture().forwardMode === "delay")
    await new Promise<void>((done) => {
      fixture().releaseForward = done;
    });
  const records = forwardedRecords();
  const existing = records.find((r) => r.actor === actor && r.input.requestId === valid.requestId);
  if (existing && JSON.stringify(existing.input) !== JSON.stringify(valid))
    throw Error("WA_FORWARD_REQUEST_CONFLICT");
  const record = existing ?? {
    actor,
    input: valid,
    id: `50000000-0000-4000-8000-${String(records.length + 1).padStart(12, "0")}`,
  };
  if (!existing) sessionStorage.setItem(forwardStorage, JSON.stringify([...records, record]));
  if (fixture().forwardMode === "timeout") {
    fixture().forwardMode = "ok";
    throw Error("Synthetic response lost after commit");
  }
  return { leadId: record.id, created: !existing };
}
export async function fetchAdminLead({ data }: { data: { id: string } }) {
  call("leadRead", data);
  if (fixture().contactReadFailure) throw Error("Synthetic contact read failure");
  const record = forwardedRecords().find((r) => r.id === data.id && canReadForward(r));
  return record ? forwardLead(record) : null;
}
export async function fetchForwardedEnquiry(leadId: string) {
  const record = forwardedRecords().find((r) => r.id === leadId && canReadForward(r));
  return record
    ? {
        raw_text: record.input.text,
        business_source: record.input.businessSource,
        original_customer_contact: record.input.originalCustomerContact,
        original_received_at: record.input.originalReceivedAt,
        source_url: record.input.sourceUrl,
        note: record.input.note,
        forwarded_by_name: "合成轉交同事",
      }
    : null;
}
export const fetchAdminLeadAiProfile = async () => ({ profile: null, tags: [] });
export const fetchLeadLiveAgentTranscript = async () => [];
export async function fetchRelatedLeadConversations(leadId: string) {
  call("relatedRead", { leadId });
  if (fixture().relatedReadFailure) throw Error("Synthetic related read failure");
  const record = forwardedRecords().find((r) => r.id === leadId && canReadForward(r));
  return record?.conversationId && readable(record.conversationId)
    ? [{ id: record.conversationId }]
    : [];
}
export async function saveLeadContact(input: LeadContactUpdateInput) {
  call("syntheticContact", input);
  const valid = validateLeadContactUpdate(input);
  if (fixture().contactMode === "delay")
    await new Promise<void>((done) => {
      fixture().releaseContact = done;
    });
  const records = forwardedRecords();
  const record = records.find((r) => r.id === valid.leadId && canReadForward(r));
  const contact = record?.contact;
  if (!contact) return deny();
  if (
    contact.id !== valid.expectedContactId ||
    !(
      (contact.name === valid.expectedName && contact.email === valid.expectedEmail) ||
      (contact.name === valid.name && contact.email === valid.email)
    )
  )
    throw Error("Synthetic stale contact");
  contact.name = valid.name;
  contact.email = valid.email;
  sessionStorage.setItem(forwardStorage, JSON.stringify(records));
  if (fixture().contactMode === "timeout") {
    fixture().contactMode = "ok";
    throw Error("Synthetic contact response lost after commit");
  }
  return { contactId: contact.id };
}
export const analyzeAdminLeadAiProfile = () => noMutation("leadAi");
export const approveAdminAiTag = () => noMutation("approveTag");
export const rejectAdminAiTag = () => noMutation("rejectTag");
export const createAdminLeadActivity = () => noMutation("leadActivity");
export const bulkUpdateAdminLeads = () => noMutation("bulkLeads");
export const updateAdminLead = () => noMutation("updateLead");
export async function fetchAdminOverview() {
  call("overview", {});
  if (fixture().failOverviewDenied) throw new Response("Forbidden", { status: 403 });
  if (fixture().failOverview) throw Error("Synthetic overview read failure");
  return {
    publicProperties: 2,
    publicOffers: 3,
    inventoryCheckedAt: now,
    openLeads: 2,
    openConversations: 2,
    contacts: 3,
    activeCampaigns: null,
    scope: actor === "manager" ? "all" : "own",
    checkedAt: now,
  };
}
// A poll reads through the same synthetic handler, and so the same call counters, as 重新整理.
export const fetchAdminPageInBackground = fetchAdminPage;
export async function fetchCommandCenterInBackground(): Promise<never> {
  call("commandCenter");
  throw Error("No synthetic fixture renders the command center");
}
// Reads fixture(), not state: window.noLinkFixture is a copy that tests mutate.
export async function fetchAdminAttentionCounts() {
  call("attention");
  if (fixture().attentionMode === "pending")
    await new Promise<void>((release) => fixture().pendingAttention.push(release));
  if (fixture().attentionMode === "failure") throw Error("Synthetic attention read failure");
  return { ...fixture().attentionCounts };
}
export async function fetchAdminTodayTasks() {
  call("todayTasks");
  return fixture().todayTasks;
}
export async function listAdminTeam() {
  return {
    members: [],
    counts: { active: 0, invited: 0, suspended: 0, attention: 0 },
    nextCursor: null,
  };
}
export async function fetchOperationsHealth() {
  return { data: { status: "healthy", checks: [], checkedAt: now }, requestId: "synthetic-read" };
}
export async function fetchOperationsAudit() {
  return { data: { rows: [], nextCursor: null }, requestId: "synthetic-read" };
}
export {
  fetchAdminCampaigns,
  fetchAdminBlastOptions,
  previewAdminAudience,
  sendAdminCampaignQueue,
  saveAdminCampaign,
  saveAdminAudience,
  deleteAdminAudience,
  cancelAdminCampaign,
  fetchCampaignRetryPreview,
  fetchCampaignSendPreview,
  requeueFailedCampaignRecipients,
} from "./synthetic-blasts";
