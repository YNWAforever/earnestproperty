import { actor } from "./synthetic-api";

// Presentation-only model. No Auth, SQL, queue job or provider port is used.
const campaignId = "60000000-0000-4000-8000-000000000001";
const templateId = "60000000-0000-4000-8000-000000000002";
const audienceId = "60000000-0000-4000-8000-000000000003";
const state = {
  readFailure: false,
  previewFailure: false,
  queueMode: "ok",
  releaseQueue: null as null | (() => void),
  cancelMode: "ok",
  releaseCancel: null as null | (() => void),
  templateStatus: "active",
  noTemplates: false,
};
Object.assign(window, { noLinkBlastFixture: state });
function call(name: string, input?: unknown) {
  (window as unknown as { noLinkFixture: { calls: unknown[] } }).noLinkFixture.calls.push({
    name,
    input,
  });
}
function requireManager() {
  if (actor !== "manager") throw Object.assign(Error("合成角色沒有推廣權限"), { status: 403 });
}
const storage = "no-link-fixture-campaigns";
function records() {
  return (
    JSON.parse(sessionStorage.getItem(storage) ?? "null") ?? [
      {
        id: campaignId,
        name: "合成租務推廣",
        template_id: templateId,
        audience_id: audienceId,
        status: "review",
        scheduled_at: null,
        element_name: "synthetic_rental",
        language_code: "zh_HK",
        audience_name: "合成群組",
        recipients: 0,
        sent: 0,
        failed: 0,
        blocked: 0,
        pending: 0,
        unknown: 0,
        dispatching: 0,
        queueWrites: 0,
        cancelWrites: 0,
        cancelled: 0,
      },
    ]
  );
}
export async function fetchAdminCampaigns() {
  call("syntheticCampaignRead");
  requireManager();
  if (state.readFailure) throw Error("合成 campaign 讀回失敗");
  return records();
}
export async function fetchAdminBlastOptions() {
  requireManager();
  return {
    templates: state.noTemplates
      ? []
      : [
          {
            id: templateId,
            element_name: "synthetic_rental",
            language_code: "zh_HK",
            status: state.templateStatus,
            category: "marketing",
            description: null,
            components: [],
          },
        ],
    audiences: [
      {
        id: audienceId,
        name: "合成群組",
        description: "深井租客",
        filters: { source: "synthetic" },
        updated_at: "2026-09-29T10:00:00Z",
      },
      {
        id: "60000000-0000-4000-8000-000000000004",
        name: "合成群組",
        description: "荃灣買家",
        filters: { source: "synthetic-other" },
        updated_at: "2026-09-28T10:00:00Z",
      },
    ],
    estates: [],
    districts: [],
    agents: [],
  };
}
export async function previewAdminAudience(input: unknown) {
  call("syntheticCampaignPreview", input);
  requireManager();
  if (state.previewFailure) throw Error("合成收件預覽失敗");
  return {
    total: 4,
    eligible: 2,
    uniqueExcluded: 2,
    optedOut: 1,
    missingPhone: 1,
    notOptedIn: 1,
    identityUnsafe: 0,
    duplicatePhone: 0,
  };
}
export async function sendAdminCampaignQueue({ data }: { data: { id: string } }) {
  call("syntheticCampaignQueue", data);
  requireManager();
  if (state.queueMode === "delay")
    await new Promise<void>((done) => {
      state.releaseQueue = done;
    });
  if (state.queueMode === "refused") return { ok: false, error: "CAMPAIGN_NOT_ELIGIBLE" };
  const rows = records(),
    row = rows.find((item: { id: string }) => item.id === data.id);
  if (!row || !["review", "scheduled"].includes(row.status))
    return { ok: false, error: "INVALID_CAMPAIGN_STATUS" };
  row.status = "queued";
  row.queueWrites++;
  row.recipients = 2;
  row.pending = 2;
  sessionStorage.setItem(storage, JSON.stringify(rows));
  if (state.queueMode === "timeout") {
    state.queueMode = "ok";
    throw Error("合成 queue commit 後回應遺失");
  }
  return {
    ok: true,
    jobId: "synthetic-job",
    jobStatus: "queued",
    materialization: { eligible: 2 },
  };
}
export async function saveAdminCampaign({ data }: { data: Record<string, unknown> }) {
  call("syntheticCampaignSave", data);
  requireManager();
  const rows = records();
  const id = String(data.id ?? "60000000-0000-4000-8000-000000000005");
  const index = rows.findIndex((item: { id: string }) => item.id === id);
  const row = { ...(index >= 0 ? rows[index] : {}), ...data, id };
  if (index >= 0) rows[index] = row;
  else rows.push(row);
  sessionStorage.setItem(storage, JSON.stringify(rows));
  return { ok: true, id };
}
export const saveAdminAudience = () => {
  throw Error("Synthetic audience write not enabled");
};
export const deleteAdminAudience = () => {
  throw Error("Synthetic audience delete not enabled");
};
export async function cancelAdminCampaign({ data }: { data: { id: string } }) {
  call("syntheticCampaignCancel", data);
  requireManager();
  if (state.cancelMode === "delay")
    await new Promise<void>((done) => {
      state.releaseCancel = done;
    });
  if (state.cancelMode === "refused") return { ok: false, error: "CAMPAIGN_CANCEL_NOT_ELIGIBLE" };
  const rows = records(),
    row = rows.find((item: { id: string }) => item.id === data.id);
  if (!row || !["draft", "review", "scheduled", "queued", "sending"].includes(row.status))
    return { ok: false, error: "CAMPAIGN_CANCEL_NOT_ELIGIBLE" };
  row.status = "cancelled";
  row.cancelWrites = (row.cancelWrites ?? 0) + 1;
  row.cancelled = (row.cancelled ?? 0) + row.pending;
  row.pending = 0;
  sessionStorage.setItem(storage, JSON.stringify(rows));
  if (state.cancelMode === "timeout") throw Error("Owned cancel commit response lost");
  return { ok: true };
}
