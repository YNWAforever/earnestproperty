import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { StaffAccess } from "./auth.server.ts";
import { queryRows, transactionRows, type DbRow, type TransactionStatement } from "./db.server.ts";
import { getEnquiryForwardingSettings } from "./enquiry-forwarding.server.ts";
import {
  buildEnquiryInfoDecisionStatement,
  enquiryInfoLockStatements,
} from "./enquiry-info-decisions.server.ts";
import type {
  EnquiryInfoDecisionInput,
  EnquiryInfoMemberEvidence,
  EnquiryInfoPhoneSnapshot,
  EnquiryInfoScope,
} from "./enquiry-info-decisions.types.ts";
import { resolveEnquiryInfoHeldReceipt } from "../whatsapp-enquiries/enquiry-info-intake.server.ts";
import {
  enquiryPhoneReviewInput,
  enquiryHeldReplyInput,
  type EnquiryInfoReviewState,
  type EnquiryHeldReplyItem,
  type EnquiryHeldReplyResult,
} from "./enquiry-info-review.types.ts";

type Actor = Pick<StaffAccess, "staffId" | "roles">;
type Ports = { query: typeof queryRows; transaction: typeof transactionRows };
const defaults: Ports = { query: queryRows, transaction: transactionRows };
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
function fail(message: string, status = 409, code = "ENQUIRY_INFO_REVIEW_CHANGED"): never {
  throw new Response(message, { status, headers: { "X-Error-Code": code } });
}
async function authorize(actor: Actor, query: typeof queryRows) {
  if (
    !actor.roles.some((role) => role === "admin" || role === "manager") ||
    !z.string().uuid().safeParse(actor.staffId).success ||
    !(
      await query(
        "SELECT s.id FROM staff_users s WHERE s.id=$1::uuid AND s.active AND EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=s.id AND r.role IN ('admin','manager'))",
        [actor.staffId],
      )
    ).length
  )
    fail("沒有身份核對權限。", 403, "ENQUIRY_INFO_REVIEWER_FORBIDDEN");
}
async function context(actor: Actor, ports: Ports) {
  try {
    await authorize(actor, ports.query);
    const settings = await getEnquiryForwardingSettings(actor, ports.query);
    if (!settings.available || !settings.informationalPolicy?.available)
      fail("通知身份核對設定未就緒，請先更新連接核對。", 503, "ENQUIRY_INFO_SCOPE_UNAVAILABLE");
    let scope = settings.informationalPolicy.scope;
    // Review established receipts through an outage; activation never uses this fallback.
    if (!scope) {
      const app = process.env.WOZTELL_APP_ID,
        channel = process.env.WOZTELL_CHANNEL_ID || process.env.EP_WA_COMPANY_CHANNEL_ID;
      if (
        app &&
        channel &&
        /^[A-Za-z0-9_-]{1,128}$/.test(app) &&
        /^[A-Za-z0-9_-]{1,128}$/.test(channel)
      ) {
        const [established] = await ports.query(
          "SELECT app_id,channel_id FROM enquiry_forwarding_decisions WHERE app_id=$1 AND channel_id=$2 AND subject_kind='policy' AND decision='armed' ORDER BY revision DESC LIMIT 1",
          [app, channel],
        );
        if (established)
          scope = { appId: String(established.app_id), channelId: String(established.channel_id) };
      }
    }
    if (!scope)
      fail("通知身份核對設定未就緒，請先更新連接核對。", 503, "ENQUIRY_INFO_SCOPE_UNAVAILABLE");
    const roster = new Map<string, string[]>();
    for (const row of settings.recipients)
      roster.set(row.phone, [...new Set([...(roster.get(row.phone) ?? []), row.name])]);
    return { scope, roster };
  } catch (error) {
    if (error instanceof Response) throw error;
    return fail("暫未能載入身份核對資料，請重新整理。", 503, "ENQUIRY_INFO_REVIEW_UNAVAILABLE");
  }
}
const heldPredicate = `r.provider='woztell' AND r.origin='live_webhook' AND r.event_kind IN ('customer_message','unsupported')
  AND r.app_id=$1 AND r.channel_id=$2 AND r.enquiry_forwarding_arm_id IS NOT NULL
  AND r.normalized_event->>'woztellMemberId' IS NOT DISTINCT FROM r.member_id
  AND r.body_digest ~ '^[a-f0-9]{64}$' AND r.normalized_event->>'appId'=r.app_id AND r.normalized_event->>'channelId'=r.channel_id AND r.normalized_event->>'direction'='inbound'
  AND r.projection_state='failed' AND r.block_reason='REVIEW_REQUIRED'
  AND (enquiry_info_head(r.app_id,r.channel_id,'receipt',r.id::text)).decision='held'
  AND EXISTS(SELECT 1 FROM enquiry_forwarding_decisions a WHERE a.id=r.enquiry_forwarding_arm_id AND a.app_id=r.app_id AND a.channel_id=r.channel_id AND a.subject_kind='policy' AND a.decision='armed')`;
/** Read-only context for the review screen, never the intake CTEs (which write holds).
 * The private intake service remains authoritative at the actual projection statement.
 */
function factsCtes(picked: string) {
  return `picked AS MATERIALIZED (${picked}),
  conversation AS MATERIALIZED (SELECT w.id,w.contact_id FROM whatsapp_conversations w,picked r WHERE w.woztell_member_id=r.member_id AND (w.channel_id=r.channel_id OR w.channel_id IS NULL) ORDER BY (w.channel_id=(SELECT channel_id FROM picked)) DESC NULLS LAST LIMIT 1),
  linked AS MATERIALIZED (SELECT c.contact_id id FROM conversation c WHERE c.contact_id IS NOT NULL AND EXISTS(SELECT 1 FROM crm_contact_identity_reviews v WHERE v.conversation_id=c.id AND v.status='linked')),
  contacts AS MATERIALIZED (SELECT c.* FROM crm_contacts c WHERE c.id IN(SELECT id FROM linked) OR (NOT EXISTS(SELECT 1 FROM linked) AND (c.whatsapp_member_id=(SELECT member_id FROM picked) OR c.id IN(SELECT contact_id FROM conversation)))),
  staff_phones AS MATERIALIZED (SELECT enquiry_notification_phone(whatsapp) phone FROM staff_users WHERE active AND show_on_website UNION SELECT enquiry_notification_phone(phone) FROM staff_users WHERE active AND show_on_website UNION SELECT d.phone FROM enquiry_forwarding_decisions d,picked r WHERE d.app_id=r.app_id AND d.channel_id=r.channel_id AND d.subject_kind='recipient_phone' AND d.decision='approved' AND (enquiry_info_head(d.app_id,d.channel_id,'recipient_phone',d.phone)).id=d.id UNION SELECT '85297987774'),
  facts AS MATERIALIZED (SELECT r.*,
    EXISTS(SELECT 1 FROM enquiry_forwarding_decisions d WHERE d.app_id=r.app_id AND d.channel_id=r.channel_id AND d.subject_kind='sender_member' AND d.member_id=r.member_id AND d.decision='staff_bound') historical_staff,
    (EXISTS(SELECT 1 FROM contacts c JOIN staff_phones p ON p.phone=enquiry_notification_phone(c.normalized_phone)) OR EXISTS(SELECT 1 FROM staff_phones p WHERE p.phone=enquiry_notification_phone(r.normalized_event->>'fromPhone'))) staff_concern,
    ARRAY(SELECT COALESCE(NULLIF(name,''),'未命名聯絡人') FROM contacts ORDER BY id LIMIT 3) contact_names,
    COALESCE((enquiry_info_head(r.app_id,r.channel_id,'receipt',r.id::text)).revision,0) receipt_revision,
    COALESCE((enquiry_info_head(r.app_id,r.channel_id,'sender_member',r.member_id)).revision,0) member_revision,
    enquiry_info_head(r.app_id,r.channel_id,'sender_member',r.member_id) member_head
    FROM picked r)`;
}
async function heldFacts(
  scope: EnquiryInfoScope,
  id: string,
  query: typeof queryRows,
): Promise<DbRow | null> {
  const [row] = await query(
    `WITH ${factsCtes(`SELECT r.* FROM whatsapp_inbound_receipts r WHERE ${heldPredicate} AND r.id=$3::uuid`)} SELECT * FROM facts`,
    [scope.appId, scope.channelId, id],
  );
  return row ?? null;
}
function memberId(row: DbRow): string | null {
  return typeof row.member_id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(row.member_id)
    ? row.member_id
    : null;
}
type Candidate =
  | { id: string; revision: number }
  | {
      phone: string;
      reviewId: string;
      staffId: string | null;
      evidence: EnquiryInfoMemberEvidence;
    };
async function staffCandidate(
  scope: EnquiryInfoScope,
  row: DbRow,
  roster: Map<string, string[]>,
  query: typeof queryRows,
): Promise<Candidate | null> {
  const member = memberId(row);
  if (!member) return null;
  const [existing] = await query(
    "SELECT id,revision FROM enquiry_info_head($1,$2,'sender_member',$3) WHERE enquiry_info_member_binding_valid(id)",
    [scope.appId, scope.channelId, member],
  );
  if (existing?.id) return { id: String(existing.id), revision: Number(existing.revision) };
  const candidates = await query(
    `WITH receipt AS (SELECT * FROM whatsapp_inbound_receipts WHERE id=$4::uuid AND app_id=$1 AND channel_id=$2 AND member_id=$3), candidates AS (
    SELECT enquiry_notification_phone(r.normalized_event->>'fromPhone') phone,jsonb_build_object('kind','accepted_ingress','receiptId',r.id) proof FROM receipt r
    UNION ALL SELECT m->>'phone',jsonb_build_object('kind','provider_audit','auditId',a.id,'proofHash',m->>'proofHash','receiptId',$4::text)
      FROM audit_logs a CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a.metadata->'members'->'matched')='array' THEN a.metadata->'members'->'matched' ELSE '[]'::jsonb END) m
      WHERE a.action='whatsapp.enquiry_forwarding.provider_checked' AND a.created_at>clock_timestamp()-interval '24 hours' AND a.created_at<=clock_timestamp() AND m->>'memberId'=$3
    ) SELECT c.phone,p.id review_id,p.staff_id,c.proof FROM candidates c CROSS JOIN LATERAL enquiry_info_head($1,$2,'recipient_phone',c.phone) p
    WHERE enquiry_info_phone_approval_valid(p.id) AND enquiry_info_member_proof_valid(c.proof,$1,$2,c.phone,$3) LIMIT 40`,
    [scope.appId, scope.channelId, member, row.id],
  );
  const valid = candidates.filter((c) => roster.has(String(c.phone)));
  if (new Set(valid.map((c) => String(c.phone))).size !== 1) return null;
  const first = valid[0];
  return first
    ? {
        phone: String(first.phone),
        reviewId: String(first.review_id),
        staffId: first.staff_id ? String(first.staff_id) : null,
        evidence: first.proof as EnquiryInfoMemberEvidence,
      }
    : null;
}
function customerAllowed(row: DbRow) {
  return !!memberId(row) && row.historical_staff !== true && row.staff_concern !== true;
}
async function heldItem(
  scope: EnquiryInfoScope,
  row: DbRow,
  roster: Map<string, string[]>,
  query: typeof queryRows,
): Promise<EnquiryHeldReplyItem> {
  const original = asRecord(row.normalized_event),
    candidate = await staffCandidate(scope, row, roster, query);
  return {
    receiptId: String(row.id),
    receivedAt: String(row.received_at),
    messageAt: typeof original.timestamp === "string" ? original.timestamp : null,
    text: typeof original.text === "string" ? original.text.slice(0, 16000) : "",
    fromPhone: typeof original.fromPhone === "string" ? original.fromPhone : null,
    expectedRevision: Number(row.receipt_revision),
    expectedMemberRevision: Number(row.member_revision),
    contactNames: Array.isArray(row.contact_names) ? row.contact_names.map(String) : [],
    customerAllowed: customerAllowed(row),
    staffAllowed: !!candidate,
    blockedReason: !memberId(row)
      ? "來訊身份資料不足，暫不能完成核對。"
      : row.historical_staff === true
        ? "已有同事身份紀錄，不能作客戶回覆處理。"
        : row.staff_concern === true
          ? "與同事通知電話有重疊，請先核對真實身份關聯。"
          : null,
  };
}
export async function getEnquiryInfoReviewState(
  actor: Actor,
  ports: Ports = defaults,
): Promise<EnquiryInfoReviewState> {
  try {
    const { scope, roster } = await context(actor, ports),
      phones: EnquiryInfoReviewState["phones"] = [];
    const historical = await ports.query(
      "SELECT d.phone FROM enquiry_forwarding_decisions d WHERE d.app_id=$1 AND d.channel_id=$2 AND d.subject_kind='recipient_phone' AND (enquiry_info_head(d.app_id,d.channel_id,'recipient_phone',d.phone)).id=d.id AND d.phone NOT IN(SELECT jsonb_array_elements_text($3::jsonb)) ORDER BY d.created_at DESC,d.id DESC LIMIT 100",
      [scope.appId, scope.channelId, JSON.stringify([...roster.keys()])],
    );
    const targets = [...roster.keys(), ...historical.map((row) => String(row.phone))];
    const states = await ports.query(
      `WITH requested AS (SELECT jsonb_array_elements_text($3::jsonb) phone), current_state AS MATERIALIZED (
      SELECT phone,enquiry_info_phone_snapshot($1,$2,phone) snapshot,enquiry_info_head($1,$2,'recipient_phone',phone) review FROM requested)
      SELECT phone,snapshot,(review).decision,COALESCE((review).revision,0) revision,enquiry_info_phone_approval_valid((review).id) valid,
        EXISTS(SELECT 1 FROM enquiry_forwarding_decisions m WHERE m.app_id=$1 AND m.channel_id=$2 AND m.subject_kind='sender_member' AND m.phone=current_state.phone AND enquiry_info_member_binding_valid(m.id)) associated FROM current_state`,
      [scope.appId, scope.channelId, JSON.stringify(targets)],
    );
    for (const state of states) {
      const phone = String(state.phone),
        names = roster.get(phone) ?? ["歷史通知電話"],
        snapshot = state.snapshot as EnquiryInfoPhoneSnapshot;
      const conflicts = asRecord(snapshot.identitySnapshot.conflicts);
      phones.push({
        phone,
        names,
        eligible: snapshot.eligible,
        retired: !roster.has(phone),
        state:
          state?.decision === "revoked"
            ? "revoked"
            : state?.decision === "approved"
              ? state.valid === true
                ? "approved"
                : "changed"
              : snapshot.originalGuardAllows && snapshot.eligible
                ? "policy"
                : "unreviewed",
        revision: Number(state?.revision ?? 0),
        profileHash: snapshot.profileHash,
        conflictHash: snapshot.conflictHash,
        customerConflictCount:
          (Array.isArray(conflicts.contacts) ? conflicts.contacts.length : 0) +
          (Array.isArray(conflicts.conversations) ? conflicts.conversations.length : 0),
        memberAssociated: state?.associated === true,
      });
    }
    const [ids, count] = await Promise.all([
      ports.query(
        `SELECT r.id FROM whatsapp_inbound_receipts r WHERE ${heldPredicate} ORDER BY r.received_at,r.id LIMIT 25`,
        [scope.appId, scope.channelId],
      ),
      ports.query(
        `SELECT count(*)::int n FROM whatsapp_inbound_receipts r WHERE ${heldPredicate}`,
        [scope.appId, scope.channelId],
      ),
    ]);
    const previews = await Promise.all(
      ids.map(async (id) => {
        const row = await heldFacts(scope, String(id.id), ports.query);
        return row ? heldItem(scope, row, roster, ports.query) : null;
      }),
    );
    const heldReplies = previews.filter((row): row is EnquiryHeldReplyItem => row !== null);
    return {
      phones,
      heldReplies,
      heldCount: Number(count[0]?.n ?? 0),
      hasMore: Number(count[0]?.n ?? 0) > heldReplies.length,
    };
  } catch (error) {
    return publicError(error);
  }
}
function publicError(error: unknown, reviewRecorded = false): never {
  if (error instanceof Response) throw error;
  const e = error as { code?: string; status?: number; name?: string };
  if (e?.name === "ZodError")
    fail("請填寫完整核對來源及內容。", 400, "ENQUIRY_INFO_REVIEW_INPUT_INVALID");
  const forbidden = e?.status === 403 || e?.code === "42501";
  fail(
    forbidden
      ? "沒有身份核對權限。"
      : reviewRecorded
        ? "身份核對已記錄，但回覆仍未完成。請重新整理後核對。"
        : "身份或核對資料已變更，請重新整理後再核對。",
    forbidden ? 403 : e?.status === 503 ? 503 : 409,
    typeof e?.code === "string" && /^ENQUIRY_INFO_[A-Z_]{1,80}$/.test(e.code)
      ? e.code
      : "ENQUIRY_INFO_REVIEW_CHANGED",
  );
}
/** Conditional LATERAL invocation gives failed CAS/hash/receipt gates zero append side effects. */
function guardedDecision(
  command: EnquiryInfoDecisionInput,
  actor: Actor,
  gate: string,
  gateParams: unknown[],
): TransactionStatement {
  const built = buildEnquiryInfoDecisionStatement(command, actor);
  if (!built.statement.includes("$14::jsonb"))
    throw Error("Enquiry information builder contract changed");
  const offset = built.params?.length ?? 0;
  const rewritten = gate.replace(/\$(\d+)/g, (_, n: string) => `$${Number(n) + offset}`);
  const call = built.statement.replace(
    "$14::jsonb",
    "$14::jsonb||jsonb_build_object('reviewGate',eligible.witness)",
  );
  return {
    statement: `WITH eligible AS MATERIALIZED (${rewritten}), recorded AS MATERIALIZED (SELECT d.* FROM eligible CROSS JOIN LATERAL (${call}) d), audit AS (INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata) SELECT actor_staff_id,'whatsapp.enquiry_forwarding.identity_reviewed','enquiry_forwarding_decisions',id,jsonb_build_object('purpose','enq_forward_info','decision',decision) FROM recorded) SELECT * FROM recorded`,
    params: [...(built.params ?? []), ...gateParams],
  };
}
export async function reviewEnquiryInfoPhone(
  input: unknown,
  actor: Actor,
  ports: Ports = defaults,
) {
  const { scope, roster } = await context(actor, ports);
  try {
    const data = enquiryPhoneReviewInput.parse(input);
    if (!roster.has(data.phone)) {
      if (data.decision !== "revoked") fail("電話不在目前核准的收件名單。");
      const [previous] = await ports.query(
        "SELECT id FROM enquiry_info_head($1,$2,'recipient_phone',$3)",
        [scope.appId, scope.channelId, data.phone],
      );
      if (!previous?.id) fail("未有這個電話的通知用途核對紀錄。");
    }
    const command: EnquiryInfoDecisionInput = {
      scope,
      subject: { kind: "recipient_phone", phone: data.phone },
      decision: data.decision,
      expectedRevision: data.expectedRevision,
      expectedProfileHash: data.profileHash,
      expectedConflictHash: data.conflictHash,
      evidence: { sourceReference: data.sourceReference, statement: data.statement },
    };
    const guarded = guardedDecision(
      command,
      actor,
      "SELECT s->>'profileHash' witness FROM (SELECT enquiry_info_phone_snapshot($1,$2,$3) s) x WHERE s->>'profileHash'=$4 AND s->>'conflictHash'=$5 AND (COALESCE((s->>'eligible')::boolean,false) OR (enquiry_info_head($1,$2,'recipient_phone',$3)).id IS NOT NULL)",
      [scope.appId, scope.channelId, data.phone, data.profileHash, data.conflictHash],
    );
    const results = await ports.transaction(
        [
          ...enquiryInfoLockStatements(scope, [command.subject], [`woztell-phone:${data.phone}`]),
          guarded,
        ],
        { isolationLevel: "ReadCommitted" },
      ),
      saved = results.at(-1)?.[0];
    if (!saved?.id) fail("收件資料已變更，請重新整理後再核對。");
    return { phone: data.phone, decision: data.decision, revision: Number(saved.revision) };
  } catch (error) {
    return publicError(error);
  }
}
export async function resolveEnquiryInfoReply(
  input: unknown,
  actor: Actor,
  ports: Ports = defaults,
): Promise<EnquiryHeldReplyResult> {
  const { scope, roster } = await context(actor, ports);
  let recorded = false;
  try {
    const data = enquiryHeldReplyInput.parse(input),
      row = await heldFacts(scope, data.receiptId, ports.query);
    if (
      !row ||
      !memberId(row) ||
      Number(row.receipt_revision) !== data.expectedRevision ||
      Number(row.member_revision) !== data.expectedMemberRevision
    )
      fail("回覆或身份資料已變更，請重新整理後再核對。");
    const member = memberId(row)!,
      evidence = { sourceReference: data.sourceReference, statement: data.statement };
    let decisionId: string;
    if (data.resolution === "customer" && !customerAllowed(row))
      fail("仍有同事身份資料需要核對，暫不能作客戶回覆處理。");
    const candidate =
      data.resolution === "staff" ? await staffCandidate(scope, row, roster, ports.query) : null;
    if (data.resolution === "staff" && !candidate)
      fail("未有可核實的同事身份關聯，請保留待核對狀態。");
    if (candidate && "id" in candidate) {
      if (candidate.revision !== data.expectedMemberRevision)
        fail("身份核對資料已變更，請重新整理。");
      decisionId = candidate.id;
    } else {
      const binding = candidate && "phone" in candidate ? candidate : null;
      const command: EnquiryInfoDecisionInput = {
        scope,
        subject: { kind: "sender_member", memberId: member },
        decision: data.resolution === "customer" ? "customer_confirmed" : "staff_bound",
        expectedRevision: data.expectedMemberRevision,
        evidence,
        ...(binding
          ? {
              phone: binding.phone,
              staffId: binding.staffId,
              relatedDecisionId: binding.reviewId,
              memberEvidence: binding.evidence,
            }
          : {}),
      };
      const gate = `WITH ${factsCtes(`SELECT r.* FROM whatsapp_inbound_receipts r WHERE ${heldPredicate} AND r.id=$3::uuid AND r.member_id=$4`)} SELECT id::text witness FROM facts WHERE receipt_revision=$5 AND member_revision=$6 ${data.resolution === "customer" ? "AND NOT historical_staff AND NOT staff_concern" : ""}`;
      const guarded = guardedDecision(command, actor, gate, [
        scope.appId,
        scope.channelId,
        data.receiptId,
        member,
        data.expectedRevision,
        data.expectedMemberRevision,
      ]);
      const subjects = [
        command.subject,
        { kind: "receipt" as const, receiptId: data.receiptId },
        ...(binding ? [{ kind: "recipient_phone" as const, phone: binding.phone }] : []),
      ];
      const identities = [
        `woztell-member:${member}`,
        ...(binding ? [`woztell-phone:${binding.phone}`] : []),
      ];
      const results = await ports.transaction(
          [...enquiryInfoLockStatements(scope, subjects, identities), guarded],
          { isolationLevel: "ReadCommitted" },
        ),
        saved = results.at(-1)?.[0];
      if (!saved?.id) fail("回覆或身份資料已變更，請重新整理後再核對。");
      decisionId = String(saved.id);
      recorded = true;
    }
    const outcome = await resolveEnquiryInfoHeldReceipt(
      {
        receiptId: data.receiptId,
        expectedRevision: data.expectedRevision,
        memberDecisionId: decisionId,
        resolution: data.resolution,
        evidence,
      },
      actor,
      ports,
    );
    const [completed] = await ports.query(
      "SELECT projection_state,(enquiry_info_head(app_id,channel_id,'receipt',id::text)).decision decision FROM whatsapp_inbound_receipts WHERE id=$1::uuid AND app_id=$2 AND channel_id=$3",
      [data.receiptId, scope.appId, scope.channelId],
    );
    if (
      completed?.projection_state !== "projected" ||
      completed.decision !== `released_${data.resolution}`
    )
      fail("身份核對已記錄，但回覆仍未完成。請重新整理後核對。");
    return {
      receiptId: data.receiptId,
      resolved: true,
      resolution: data.resolution,
      messageInserted: outcome.messageInserted === true,
    };
  } catch (error) {
    return publicError(error, recorded);
  }
}
