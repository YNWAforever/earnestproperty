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
  retryMode: "ok" as "ok" | "refused" | "previewFailure" | "lost" | "forbidden",
  retryRefusal: "CAMPAIGN_STILL_SENDING",
  audienceEligible: 2,
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
        retryable_failed: 0,
        paused: 0,
        delivery_started: false,
        requeueWrites: 0,
      },
    ]
  );
}
export async function fetchAdminCampaigns() {
  call("syntheticCampaignRead");
  requireManager();
  if (state.readFailure) throw Error("合成 campaign 讀回失敗");
  return retryRecords();
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
    eligible: state.audienceEligible,
    uniqueExcluded: 2,
    optedOut: 1,
    missingPhone: 1,
    notOptedIn: 1,
    identityUnsafe: 0,
    duplicatePhone: 0,
  };
}
export async function sendAdminCampaignQueue({
  data,
}: {
  data: { id: string; expectedCount?: number | null };
}) {
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
  if (row.synthetic_recipients && deriveCounts(row as RetryRow).delivery_started) {
    // Like the server: with history the confirmed count must match what the
    // queue would send after materialise, or nothing is queued.
    const sendable = countOf(row.synthetic_recipients as SyntheticRecipient[], sendableNow);
    if (data.expectedCount !== sendable)
      return { ok: false, error: "SEND_COUNT_CHANGED", sendable };
  }
  row.status = "queued";
  row.queueWrites++;
  let queuedRecipients = 2;
  if (row.synthetic_recipients) {
    // Like the server: only waiting rows that still pass dispatch eligibility
    // go forward; the rest are held back. The result reports that count.
    const list = row.synthetic_recipients as SyntheticRecipient[];
    for (const r of list)
      if (r.status === "queued" && !r.dispatched && !sendableNow(r)) r.status = "blocked";
    queuedRecipients = countOf(list, dispatchableQueued);
    saveRecords(rows);
  } else {
    row.recipients = 2;
    row.pending = 2;
    sessionStorage.setItem(storage, JSON.stringify(rows));
  }
  if (state.queueMode === "timeout") {
    state.queueMode = "ok";
    throw Error("合成 queue commit 後回應遺失");
  }
  return {
    ok: true,
    jobId: "synthetic-job",
    jobStatus: "queued",
    // The audience summary deliberately differs from what is queued.
    materialization: { eligible: state.audienceEligible },
    queuedRecipients,
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
// FX-10b retry model. A seeded row may carry `synthetic_recipients`; every
// count the screen shows is then derived here from those recipients with the
// same rules the server applies (campaign-retry.ts), so the tests assert the
// UI against this independent model instead of restating numbers.
type SyntheticRecipient = {
  status: "sent" | "failed" | "queued" | "blocked" | "cancelled";
  error?: string | null;
  dispatched?: boolean;
  /** opt-in and not opted out, identity safe. Default true. */
  consent?: boolean;
  /** The contact changed after the refused attempt. */
  contactChanged?: boolean;
  /** Not the primary row for its phone in this campaign. */
  duplicatePhone?: boolean;
  /** No longer in the campaign's audience (materialise would block it). */
  outOfAudience?: boolean;
  /** Dispatched once before (the server's attempted_identity). */
  attempted?: boolean;
  name?: string | null;
};
type RetryRow = Record<string, unknown> & {
  id: string;
  status: string;
  pending: number;
  synthetic_recipients?: SyntheticRecipient[];
};
const retryableStatuses = ["failed", "completed", "review"];
const retrySafeCodes = ["WOZTELL_PROVIDER_REJECTED", "WOZTELL_DELIVERY_ATTEMPTS_EXHAUSTED"];
const consentOk = (r: SyntheticRecipient) => r.consent !== false;
const retryableFailed = (r: SyntheticRecipient) =>
  r.status === "failed" && !r.dispatched && retrySafeCodes.includes(r.error ?? "");
const retryEligible = (r: SyntheticRecipient) =>
  retryableFailed(r) && consentOk(r) && !r.contactChanged && !r.duplicatePhone;
const dispatchableQueued = (r: SyntheticRecipient) =>
  r.status === "queued" && !r.dispatched && consentOk(r) && !r.duplicatePhone;
/** What 發送… would send: dispatchable and still in the audience. */
const sendableNow = (r: SyntheticRecipient) => dispatchableQueued(r) && !r.outOfAudience;
const isUnknown = (r: SyntheticRecipient) => r.error === "WOZTELL_DELIVERY_UNKNOWN";
const countOf = (list: SyntheticRecipient[], test: (r: SyntheticRecipient) => boolean) =>
  list.filter(test).length;
function retryableNow(row: RetryRow) {
  const list = row.synthetic_recipients ?? [];
  return retryableStatuses.includes(row.status) ? countOf(list, retryEligible) : 0;
}
/** The list columns, derived from the recipients like listAdminCampaigns. */
function deriveCounts(row: RetryRow) {
  const list = row.synthetic_recipients;
  if (!list) return row;
  return Object.assign(row, {
    recipients: list.length,
    sent: countOf(list, (r) => r.status === "sent"),
    failed: countOf(list, (r) => r.status === "failed" && !isUnknown(r)),
    unknown: countOf(list, isUnknown),
    blocked: countOf(list, (r) => r.status === "blocked"),
    cancelled: countOf(list, (r) => r.status === "cancelled"),
    pending: countOf(list, (r) => r.status === "queued" && !r.dispatched),
    paused: countOf(list, (r) => r.status === "queued" && r.error === "WOZTELL_CAMPAIGN_PAUSED"),
    retryable_failed: retryableNow(row),
    delivery_started: hasHistory(list),
    // Like listAdminCampaigns: counted without the audience.
    finishable:
      row.status === "review" &&
      hasHistory(list) &&
      (state.templateStatus !== "active" || countOf(list, dispatchableQueued) === 0),
  });
}
const hasHistory = (list: SyntheticRecipient[]) =>
  list.some((r) => r.dispatched || r.attempted || ["sent", "failed"].includes(r.status));
function retryRecords() {
  return (records() as RetryRow[]).map(deriveCounts);
}
function saveRecords(rows: RetryRow[]) {
  sessionStorage.setItem(storage, JSON.stringify(rows.map(deriveCounts)));
}
export async function fetchCampaignRetryPreview({ data }: { data: { id: string } }) {
  call("syntheticCampaignRetryPreview", data);
  requireManager();
  if (state.retryMode === "previewFailure") throw Error("合成重新發送預覽失敗");
  const row = retryRecords().find((item) => item.id === data.id);
  if (!row) throw Error("Campaign not found");
  const list = row.synthetic_recipients ?? [];
  const optedOut = countOf(list, (r) => retryableFailed(r) && !consentOk(r));
  const changed = countOf(list, (r) => retryableFailed(r) && consentOk(r) && !!r.contactChanged);
  const duplicate = countOf(
    list,
    (r) => retryableFailed(r) && consentOk(r) && !r.contactChanged && !!r.duplicatePhone,
  );
  const unknown = list.filter(isUnknown);
  return {
    campaignId: row.id,
    status: row.status,
    retryable: retryableNow(row),
    alreadyQueued: countOf(list, dispatchableQueued),
    excludedOptedOut: optedOut,
    excludedDuplicatePhone: duplicate,
    excludedContactChanged: changed,
    exclusions: (
      [
        ["OPTED_OUT", optedOut],
        ["DUPLICATE_PHONE", duplicate],
        ["CONTACT_CHANGED_SINCE_ATTEMPT", changed],
      ] as const
    )
      .map(([reason, count]) => ({ reason, count }))
      .filter((item) => item.count > 0),
    unknownTotal: unknown.length,
    unknown: unknown.slice(0, 100).map((r, index) => ({
      recipientId: `60000000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`,
      name: r.name ?? null,
      dispatchedAt: "2026-09-30T10:00:00Z",
    })),
  };
}
export async function requeueFailedCampaignRecipients({
  data,
}: {
  data: { campaignId: string; expectedCount: number };
}) {
  call("syntheticCampaignRequeue", data);
  requireManager();
  if (state.retryMode === "forbidden") throw Object.assign(Error("Forbidden"), { status: 403 });
  if (state.retryMode === "refused") return { ok: false, error: state.retryRefusal };
  const rows = retryRecords(),
    row = rows.find((item) => item.id === data.campaignId);
  if (!row) return { ok: false, error: "Campaign not found" };
  if (!retryableStatuses.includes(row.status))
    return { ok: false, error: "CAMPAIGN_NOT_RETRYABLE" };
  const list = row.synthetic_recipients ?? [];
  const pick = list.filter(retryEligible);
  if (pick.length === 0) return { ok: false, error: "NOTHING_TO_RETRY" };
  if (pick.length !== data.expectedCount)
    return { ok: false, error: "RETRY_COUNT_CHANGED", retryable: pick.length };
  for (const r of pick) Object.assign(r, { status: "queued", error: null, attempted: true });
  row.status = "review";
  row.requeueWrites = Number(row.requeueWrites ?? 0) + 1;
  saveRecords(rows);
  if (state.retryMode === "lost") throw Error("合成重新排入回應遺失");
  return {
    ok: true,
    requeued: pick.length,
    excludedUnknown: countOf(list, isUnknown),
    excludedOther: countOf(list, (r) => r.status === "failed" && !isUnknown(r)),
    excludedContactChanged: countOf(list, (r) => retryableFailed(r) && !!r.contactChanged),
  };
}
export async function fetchCampaignSendPreview({ data }: { data: { id: string } }) {
  call("syntheticCampaignSendPreview", data);
  requireManager();
  const row = retryRecords().find((item) => item.id === data.id);
  if (!row) throw Error("Campaign not found");
  if (!row.delivery_started)
    return { campaignId: row.id, deliveryStarted: false, sendable: null, finishable: false };
  const sendable = countOf(row.synthetic_recipients ?? [], sendableNow);
  return {
    campaignId: row.id,
    deliveryStarted: true,
    sendable,
    finishable: row.status === "review" && (state.templateStatus !== "active" || sendable === 0),
  };
}
// FX-10b I2: finishCampaignWithoutSending, with the server's guards.
export async function finishCampaignWithoutSending({ data }: { data: { campaignId: string } }) {
  call("syntheticCampaignFinish", data);
  requireManager();
  const rows = retryRecords(),
    row = rows.find((item) => item.id === data.campaignId);
  if (!row) return { ok: false, error: "Campaign not found" };
  const list = row.synthetic_recipients ?? [];
  if (["completed", "failed"].includes(row.status) && Number(row.finishWrites ?? 0) > 0)
    return { ok: true, status: row.status, blocked: 0, alreadyFinished: true };
  if (row.status !== "review" || !row.delivery_started)
    return { ok: false, error: "CAMPAIGN_NOT_FINISHABLE" };
  const sendable = countOf(list, sendableNow);
  if (state.templateStatus === "active" && sendable > 0)
    return { ok: false, error: "CAMPAIGN_HAS_SENDABLE", sendable };
  let blocked = 0;
  for (const r of list)
    if (r.status === "queued" && !r.dispatched) {
      Object.assign(r, { status: "blocked", error: "CAMPAIGN_FINISHED_NOT_SENDABLE" });
      blocked += 1;
    }
  const notSent = countOf(list, (r) => r.status === "failed" || r.status === "blocked");
  row.status = notSent >= list.length ? "failed" : "completed";
  row.finishWrites = Number(row.finishWrites ?? 0) + 1;
  saveRecords(rows);
  return { ok: true, status: row.status, blocked };
}
