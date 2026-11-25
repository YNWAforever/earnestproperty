import { useState } from "react";
import { Button } from "@/components/ui/button";
import { adminErrorMessage } from "./admin-error-text";
import {
  fetchHistoricalRecipients,
  reviewHistoricalRecipient,
  sendHistoricalNotification,
} from "@/lib/neon/historical-resend";

type Target = { leadId: string; staffId: string };
const hkt = new Intl.DateTimeFormat("zh-HK", {
  timeZone: "Asia/Hong_Kong",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const outcomes: Record<string, string> = {
  accepted: "供應商已接納，等待送達回條。",
  delivered: "已送達。",
  unknown: "供應商結果未明，已鎖定這份通知以免重發。",
  failed: "供應商已拒絕發送。",
  suppressed: "收件資格有變，已停止發送。",
  duplicate: "已有發送紀錄，請查看最新狀態。",
  blocked: "未通過發送前核對。",
};
const reasons: Record<string, string> = {
  no_recipient_proof: "未有足夠的同事身分及收件證據。",
  hours_receipt_missing: "欠缺本人確認可全日接收通知的有效回條。",
  hours_not_approved: "同事的全日收件時段尚未核准。",
  company_approval_missing: "欠缺公司核准此收件號碼的紀錄。",
  permission_missing: "欠缺同事的有效收件許可。",
  first_confirmation_missing: "未能核實首個同號紀錄的來源。",
  directory_mismatch: "已核實的號碼與同事名冊不符。",
  identity_receipt_missing: "未能核實這個號碼屬於該同事。",
  purpose_receipt_missing: "欠缺本人同意接收客戶查詢的有效回條。",
  phone_approval_revoked: "此號碼的核准已撤回。",
  shared_phone: "其他同事亦使用這個號碼。",
  conflict_unresolved: "現有證據未能排除同號客戶紀錄的衝突。",
  duplicate_review_required: "其他通知紀錄未能確認收件人，需先核對。",
  ledger_terminal: "這份通知已有結案紀錄。",
  lead_not_found: "原有查詢已變更或無法核實。",
  channel_unconfigured: "未設定公司 WhatsApp 渠道。",
  origin_unconfigured: "未設定後台連結。",
  endpoint_retired: "同事的收件號碼已停用。",
  authority_mismatch: "號碼設定與最新核准紀錄不符。",
  authority_missing: "欠缺號碼設定的核准紀錄。",
  staff_inactive: "這位同事的帳戶已停用。",
  endpoint_missing: "欠缺這位同事的收件號碼。",
  timezone_mismatch: "核准時段與香港時區不符。",
  runtime_disabled: "同事 WhatsApp 通知未啟用。",
  template_unconfigured: "通知範本未就緒。",
  channel_mismatch: "公司渠道有變。",
  transport_capability_unverified: "公司發送服務尚未核實。",
  historical_migration_pending: "補發紀錄表尚待安裝，暫時只可核對收件資料。",
  original_jobs_pending: "原有通知仍在處理。",
  cross_route_in_flight: "另一條通知途徑正在處理此查詢。",
  recipient_already_sent: "這位收件人已有發送紀錄。",
  ledger_unknown_permanent: "之前的發送結果未明，已鎖定補發。",
  recipient_not_in_historical_scope: "收件人與原有查詢分派不符。",
};
const resolutionText = {
  clear: "同號紀錄沒有衝突。",
  staff_confirmation_projection: "首個同號 CRM 紀錄來自同事的身分確認訊息。",
  current_phone_approval: "現有的同號覆核紀錄仍然有效，已核對目前的 CRM 衝突。",
  unresolved: "同號紀錄的收件資格未核實。",
};
function reasonText(code: string) {
  return (
    reasons[code.replace(/^proof_not_ready:/, "")] ??
    (code.startsWith("proof_not_ready:") ? "同事收件證據仍待覆核。" : "請核對原有查詢及收件資格。")
  );
}

export function HistoricalApproval({
  previewOnly,
  ready,
  checked,
  busy,
  onCheck,
  onSend,
}: {
  previewOnly: boolean;
  ready: boolean;
  checked: boolean;
  busy: boolean;
  onCheck: (value: boolean) => void;
  onSend: () => void;
}) {
  if (previewOnly) return <p>此環境只供預覽及核對。</p>;
  if (!ready) return null;
  return (
    <>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onCheck(event.target.checked)}
        />
        我已核對身分證據及 CRM 紀錄，確認這位同事可收取這宗查詢。
      </label>
      <Button type="button" disabled={!checked || busy} onClick={onSend}>
        批准並發送這份通知
      </Button>
    </>
  );
}

export function HistoricalStaffResend({
  isWorkspaceCurrent: current,
}: {
  isWorkspaceCurrent: () => boolean;
}) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchHistoricalRecipients>> | null>(
    null,
  );
  const [review, setReview] = useState<Awaited<
    ReturnType<typeof reviewHistoricalRecipient>
  > | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function run(action: () => Promise<void>) {
    if (busy || !current()) return;
    setBusy(true);
    setNotice("");
    setChecked(false);
    setReview(null);
    try {
      await action();
    } catch (error) {
      if (current()) setNotice(adminErrorMessage(error, "未能核實最新狀態，請重新覆核。"));
    } finally {
      if (current()) setBusy(false);
    }
  }
  const load = () =>
    run(async () => {
      const result = await fetchHistoricalRecipients(current);
      if (current()) setRows(result);
    });
  const inspect = (row: Target) =>
    run(async () => {
      const result = await reviewHistoricalRecipient(
        { leadId: row.leadId, staffId: row.staffId },
        current,
      );
      if (current()) setReview(result);
    });
  const send = () => {
    if (!review?.ready || !review.fingerprint || review.previewOnly || !checked) return;
    const fingerprint = review.fingerprint;
    return run(async () => {
      const result = await sendHistoricalNotification(
        {
          leadId: review.leadId,
          staffId: review.staffId,
          fingerprint,
          identityReviewed: true,
        },
        current,
      );
      if (current()) {
        const state =
          result.state === "duplicate" && result.dispatchState
            ? result.dispatchState
            : result.state;
        const summary = outcomes[state] ?? "請重新核對發送紀錄。";
        setNotice(
          result.state === "blocked" && result.reason
            ? `${summary}${reasonText(result.reason)}`
            : summary,
        );
      }
    });
  };
  const checkedReceipt = (kind: "consent" | "all_hours" | "destination_proof") =>
    review?.review?.receipts.some(
      (r) => r.kind === kind && r.verified && r.matchedMember && r.matchedPhone && r.attested,
    );
  return (
    <section className="space-y-4 rounded-lg border p-4" aria-label="舊查詢逐份補發">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">舊查詢逐份補發</h2>
        <Button type="button" variant="outline" disabled={busy} onClick={load}>
          {rows ? "重新載入" : "查看待核對通知"}
        </Button>
      </div>
      {rows &&
        (rows.length ? (
          <ul className="divide-y">
            {rows.map((row) => (
              <li
                className="flex flex-wrap items-center justify-between gap-2 py-2"
                key={`${row.leadId}:${row.staffId}`}
              >
                <span>
                  <a className="underline" href={`/admin/leads?lead=${row.leadId}`}>
                    {row.sourceLabel}
                  </a>{" "}
                  · {hkt.format(new Date(row.createdAt))} · {row.staffName}
                </span>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => inspect(row)}>
                  覆核收件人
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p>這批查詢暫無可覆核的收件人。</p>
        ))}
      {review && (
        <div className="space-y-3 rounded-md bg-muted p-3">
          <h3 className="font-medium">
            {review.staffName} · {review.maskedDestination}
          </h3>
          <p>
            {review.sourceLabel}
            {review.createdAt && ` · ${hkt.format(new Date(review.createdAt))}`}
          </p>
          {review.review && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt>本人號碼</dt>
              <dd>
                {checkedReceipt("destination_proof")
                  ? "已核對公司 WhatsApp 入站回條"
                  : review.review.receipts.some(
                        (receipt) =>
                          receipt.kind === "destination_proof" &&
                          receipt.verified &&
                          receipt.matchedPhone,
                      )
                    ? "號碼有簽署入站回條，補發身分仍待覆核"
                    : "未核實"}
              </dd>
              <dt>收件用途</dt>
              <dd>{checkedReceipt("consent") ? "同事已確認接收查詢通知" : "未核實"}</dd>
              <dt>收件時段</dt>
              <dd>
                {checkedReceipt("all_hours") &&
                review.review.hoursApproved &&
                review.review.allowAllHours
                  ? "每日 24 小時"
                  : "未核實"}
              </dd>
              <dt>CRM 同號紀錄</dt>
              <dd>
                {review.review.conflictCounts.crmContacts} 條，當中{" "}
                {review.review.conflictCounts.sameMemberContacts} 條屬同一 WhatsApp 帳戶
              </dd>
              <dt>同號核對結果</dt>
              <dd>{resolutionText[review.review.conflictResolution]}</dd>
            </dl>
          )}
          {review.ledger.dispatchState && (
            <p>發送紀錄 · {outcomes[review.ledger.dispatchState] ?? "處理中，請稍後核對。"}</p>
          )}
          {review.reasons.length > 0 && (
            <ul className="list-disc pl-5">
              {[...new Set(review.reasons.map(reasonText))].map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          <HistoricalApproval
            previewOnly={review.previewOnly}
            ready={review.ready && !!review.fingerprint}
            checked={checked}
            busy={busy}
            onCheck={setChecked}
            onSend={send}
          />
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
