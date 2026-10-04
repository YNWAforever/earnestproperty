// Explicit owned browser model: no Auth, SQL, provider, phone or worker calls.
export * from "./synthetic-api";
import { fetchAdminAgents as propertyAgents } from "./synthetic-api";
export const staffId = "60000000-0000-4000-8000-000000000001";
export const otherStaffId = "60000000-0000-4000-8000-000000000002";
const state = {
  calls: [] as { name: string; input?: unknown }[],
  directory: "ok",
  review: "verified",
  submit: "ok",
  read: sessionStorage.getItem("staff-read-mode") ?? "ok",
  endpointVersion: 1,
  result: "accepted",
  savedVersion: 0,
};
declare global {
  interface Window {
    staffFixture: typeof state;
  }
}
window.staffFixture = state;
const call = (name: string, input?: unknown) => state.calls.push({ name, input });
const actors = [
  {
    id: staffId,
    name: "Haze",
    email: "haze.eps@synthetic.invalid",
    branch: "深井",
    active: true,
    roles: ["agent"],
  },
  {
    id: otherStaffId,
    name: "Haze",
    email: "haze.ept@synthetic.invalid",
    branch: "青山公路",
    active: true,
    roles: ["agent"],
  },
  {
    id: "60000000-0000-4000-8000-000000000003",
    name: "離職同事",
    email: "departed@synthetic.invalid",
    branch: "深井",
    active: false,
    roles: ["agent"],
  },
];
export const fetchAdminAgents = async () =>
  location.pathname.includes("whatsapp-settings") ? actors : propertyAgents();
export const finalFixUiFlags = {
  staffDirectorySetup: true,
  staffReviewEnforcement: true,
  linkBatchImport: false,
  salesPerformanceReporting: false,
};
const ready = { state: "ready", reasons: [] };
const blocked = {
  state: "blocked",
  reasons: [{ code: "endpoint_disabled", message: "手機通知尚未獲授權" }],
};
export const getWhatsappStaffReadiness = async () =>
  actors
    .filter((a) => a.active)
    .map((a) => ({
      staffId: a.id,
      displayName: a.name,
      assignment: state.savedVersion ? ready : blocked,
      inboxPrivateNote: ready,
      staffWhatsapp: blocked,
      maskedDestination: "合成接單群組",
      mappingVersion: state.savedVersion || null,
    }));
export const getWhatsappRuntimeStatus = async () => ({
  customerReply: {
    state: "unknown",
    reasons: [{ code: "fixture_only", message: "真回覆能力未驗" }],
  },
});
const mappingStore = () => JSON.parse(localStorage.getItem("staff-fixture-mapping") ?? "[]");
export const getWhatsappStaffChannels = async () => {
  call("mapping-read");
  const rows = mappingStore();
  state.savedVersion = rows[0]?.version ?? 0;
  return rows;
};
export const getInboxFolders = async () => {
  call("folders");
  const mode =
    state.directory === "ok"
      ? (sessionStorage.getItem("staff-folder-mode") ?? "ok")
      : state.directory;
  if (mode === "empty") return [];
  if (mode === "denied")
    throw Object.assign(Error("owned denied"), { status: 403, requestId: "owned-folder-denied" });
  if (mode === "outage") throw Error("owned provider unavailable");
  return [
    {
      folderKey: "owned-sales",
      displayName: "合成接單群組",
      providerFolderId: "owned-folder",
      source: "admin_catalog",
      version: 1,
    },
  ];
};
export const getInboxCandidates = async (input: { cursor?: string }) => {
  call("candidates", input);
  if (state.directory === "outage") throw Error("owned provider unavailable");
  const i = input.cursor ? 1 : 0;
  return {
    items: [
      {
        userId: `owned-haze-${i}`,
        displayName: "Haze",
        email: actors[i].email,
        channelId: "owned-channel",
        role: "agent",
      },
    ],
    nextCursor: i ? null : "owned-next",
    checkedAt: new Date().toISOString(),
  };
};
export const verifyInboxCandidate = async (input: unknown) => {
  call("verify", input);
  if (state.review === "outage") throw Error("owned provider unavailable");
  return {
    evidenceId: "70000000-0000-4000-8000-000000000001",
    result: state.review === "denied" ? "denied" : "verified",
    expiresAt: new Date(Date.now() + (state.review === "expired" ? -1000 : 60000)).toISOString(),
    reasons: state.review === "denied" ? ["所選帳戶不在此 Folder"] : [],
  };
};
export const saveReviewedWhatsappStaffChannel = async (input: {
  staffId: string;
  expectedVersion: number | null;
}) => {
  call("mapping-save", input);
  const rows = [
    {
      id: "80000000-0000-4000-8000-000000000001",
      staff_id: input.staffId,
      version: (input.expectedVersion ?? 0) + 1,
      inbox_user_id: "owned-haze-0",
      folder_id: "owned-folder",
      eligible: true,
      review_enforced: true,
      review_basis: "provider_verified",
      verified_at: new Date().toISOString(),
      retired_at: null,
    },
  ];
  localStorage.setItem("staff-fixture-mapping", JSON.stringify(rows));
  if (state.submit === "save-delayed")
    await new Promise<void>((release) =>
      window.propertyFixture.pending.push({ kind: "mapping-save", release }),
    );
  call("mapping-save-return", input);
  return { mappingId: rows[0].id, version: rows[0].version };
};
export const fetchStaffEndpoints = async () => [
  {
    id: "90000000-0000-4000-8000-000000000001",
    staffId,
    transport: "inbox_private_note",
    version: state.endpointVersion,
    retired: false,
    enabled: true,
    allowAllHours: false,
    destinationReference: "owned-haze-0",
    verificationRef: "owned-review",
    permissionRef: "owned-consent",
  },
];
export const fetchStaffEventReview = async () => [];
export const fetchStaffAttention = async () => [];
export const fetchStaffNotificationHealth = async () => ({ schemaAvailable: true, counts: {} });
export const fetchStaffReferences = async () => [];
export const getWhatsappServicePolicies = async () => [];
const outsideFixture = async () => {
  throw Error("Configuration writes are outside this fixture");
};
export const updateStaffEndpoint = outsideFixture,
  turnOffStaffEndpoint = outsideFixture,
  createStaffReference = outsideFixture,
  disableStaffReference = outsideFixture,
  saveNamedInboxFolder = outsideFixture,
  retireWhatsappStaffChannel = outsideFixture,
  saveWhatsappServicePolicy = outsideFixture,
  approveWhatsappServicePolicy = outsideFixture;
export const previewStaffTestNotification = async (input: {
  staffId: string;
  transport: string;
  endpointVersion: number;
}) => {
  call("preview", input);
  return {
    ready: true,
    reasons: [],
    previewToken: crypto.randomUUID(),
    staffName: "Haze",
    transport: input.transport,
    maskedDestination: "合成接單群組",
    message: "[測試] 合成同事通知",
    endpointVersion: input.endpointVersion,
    mappingVersion: 1,
  };
};
type Attempt = {
  requestId: string;
  attemptId: string;
  state: string;
  transport: string;
  endpointVersion: number;
  mappingVersion: number;
  providerAcceptedAt: string | null;
  providerDeliveredAt: string | null;
  recipientConfirmedAt: string | null;
  acknowledgementAt: string | null;
  evidenceSource: string | null;
};
const attempts = (): Attempt[] =>
  JSON.parse(localStorage.getItem("staff-fixture-attempts") ?? "[]");
export const enqueueStaffTestNotification = async (input: {
  requestId: string;
  transport: string;
  endpointVersion: number;
}) => {
  call("enqueue", input);
  const rows = attempts();
  let saved = rows.find((a) => a.requestId === input.requestId);
  if (!saved) {
    saved = {
      requestId: input.requestId,
      attemptId: crypto.randomUUID(),
      state: state.result,
      transport: input.transport,
      endpointVersion: input.endpointVersion,
      mappingVersion: 1,
      providerAcceptedAt: state.result === "accepted" ? "2026-10-03T03:00:00Z" : null,
      providerDeliveredAt: null,
      recipientConfirmedAt: null,
      acknowledgementAt: null,
      evidenceSource: "synthetic-provider-acceptance",
    };
    rows.push(saved);
    localStorage.setItem("staff-fixture-attempts", JSON.stringify(rows));
  }
  if (state.submit === "unknown") throw Error("owned response lost after commit");
  return { attemptId: saved.attemptId };
};
export const findStaffTestNotificationByRequest = async (id: string) => {
  call("find", id);
  if (state.read === "outage") throw Error("owned read unavailable");
  return attempts().find((a) => a.requestId === id) ?? null;
};
export const getStaffTestNotification = async (id: string) => {
  call("read-attempt", id);
  if (state.read === "outage") throw Error("owned read unavailable");
  const saved = attempts().find((a) => a.attemptId === id);
  if (!saved) throw Error("owned attempt unavailable");
  return saved;
};
export const confirmStaffTestReceipt = async (input: { attemptId: string }) => {
  call("manual-confirm", input);
  const rows = attempts(),
    saved = rows.find((a) => a.attemptId === input.attemptId)!;
  saved.recipientConfirmedAt = new Date().toISOString();
  saved.evidenceSource = "manual_confirmation";
  localStorage.setItem("staff-fixture-attempts", JSON.stringify(rows));
};
