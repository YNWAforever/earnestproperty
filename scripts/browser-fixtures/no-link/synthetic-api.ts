// Test-only API model. This is presentation evidence, not server ACL or provider proof.
import {
  validateForwardedEnquiry,
  type ForwardedEnquiryInput,
} from "../../../src/lib/whatsapp-enquiries/forwarded-enquiries";
export const actor = sessionStorage.getItem("no-link-fixture-actor") ?? "agent-a";
export const ids = {
  a: "10000000-0000-4000-8000-000000000001",
  b: "10000000-0000-4000-8000-000000000002",
  private: "10000000-0000-4000-8000-000000000003",
  staff: "20000000-0000-4000-8000-000000000001",
  staffB: "20000000-0000-4000-8000-000000000002",
  enquiry: "30000000-0000-4000-8000-000000000001",
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
  templateFailure: false,
  assignmentFailure: false,
  delayDetail: false,
  releaseLateDetail: null as null | (() => void),
  forwardMode: "ok",
  releaseForward: null as null | (() => void),
};
Object.assign(window, {
  noLinkFixture: { ...state, ids, actor, lastMessage: rows[0].messages.at(-1)!.text },
});
const fixture = () => (window as unknown as { noLinkFixture: typeof state }).noLinkFixture;
const call = (name: string, input?: unknown) => fixture().calls.push({ name, input });
function readable(id: string) {
  return actor === "agent-a" && rows.some((r) => r.id === id);
}
function deny() {
  throw Error("沒有查看此對話的權限。");
}
export async function fetchStaffSession() {
  call("staffSession");
  return actor === "viewer"
    ? { status: "denied", reason: "not-staff" }
    : {
        status: "ok",
        roles: [actor === "manager" ? "manager" : "agent"],
        staffId: actor === "agent-b" ? ids.staffB : ids.staff,
      };
}
export async function fetchAdminAgents() {
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
  return [];
}
export async function fetchAdminPage({
  data,
}: {
  data: { resource: string; conversationId?: string; q?: string; cursor?: string };
}) {
  call("page", data);
  if (data.resource === "leads") {
    const leads = forwardedRecords().filter(canReadForward).map(forwardLead);
    return { rows: leads, total: leads.length, nextCursor: null };
  }
  if (data.resource === "conversations") {
    const allowed =
      actor === "agent-a"
        ? rows.filter(
            (r) =>
              !data.q ||
              [r.name, r.external_listing_id, r.public_listing_no].some((s) => s.includes(data.q!)),
          )
        : [];
    return {
      rows: allowed.map((r) => ({ ...r, messages: undefined })),
      total: allowed.length,
      nextCursor: null,
    };
  }
  if (data.resource === "messages") {
    if (!readable(data.conversationId!)) return deny();
    return {
      rows: rows.find((r) => r.id === data.conversationId)!.messages,
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
export async function fetchAdminConversationAiAssist() {
  call("ai-read");
  return null;
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
          id: ids.enquiry,
          property: "A074714",
          source: "28Hse",
          dealType: "sale",
          requestedStaffId: ids.staff,
          requestedStaffName: staffName,
          firstResponseAt: null,
          dueAt: null,
          review: false,
        },
      ],
    },
  };
}
export async function getWhatsappEnquiryQueue() {
  return [];
}
export async function fetchMyStaffNotifications() {
  return { available: true, items: [], nextCursor: null };
}
function noMutation(name: string, input?: unknown): never {
  call(name, input);
  throw Error("Synthetic fixture forbids mutations");
}
export const sendAdminConversationReply = (input: unknown) => noMutation("sendReply", input);
export const sendAdminConversationTemplate = (input: unknown) => noMutation("sendTemplate", input);
export const updateAdminConversation = (input: unknown) => noMutation("updateConversation", input);
export const runAdminWoztellBackfill = () => noMutation("backfill");
export const setWhatsappMarketingConsent = () => noMutation("consent");
export const confirmStaffNotification = () => noMutation("confirmStaff");
export const askStaffNotificationHelp = () => noMutation("staffHelp");
export const correctWhatsappEnquiry = () => noMutation("correctEnquiry");
export const fetchWhatsappEnquiryDetail = async () => deny();

// Session-only model for CRM presentation. This deliberately does not claim SQL/auth evidence.
type ForwardRecord = { input: ForwardedEnquiryInput; actor: string; id: string };
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
    source: "manual_forward",
    name: null,
    phone: null,
    email: null,
    contact_id: null,
    opt_in_whatsapp: false,
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
export const fetchRelatedLeadConversations = async () => [];
export const saveLeadContact = () => noMutation("contactEdit");
export const analyzeAdminLeadAiProfile = () => noMutation("leadAi");
export const approveAdminAiTag = () => noMutation("approveTag");
export const rejectAdminAiTag = () => noMutation("rejectTag");
export const createAdminLeadActivity = () => noMutation("leadActivity");
export const bulkUpdateAdminLeads = () => noMutation("bulkLeads");
export const updateAdminLead = () => noMutation("updateLead");
