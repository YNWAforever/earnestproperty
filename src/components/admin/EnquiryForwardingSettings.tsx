import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { normalizePhone } from "@/lib/phone.js";
import {
  fetchEnquiryForwardingSettings,
  requestEnquiryForwardingCheck,
  updateEnquiryForwardingEnabled,
} from "@/lib/neon/enquiry-forwarding";
import type { EnquiryForwardingSettings as Settings } from "@/lib/neon/enquiry-forwarding.types";

export function EnquiryForwardingSettings({
  isWorkspaceCurrent,
}: {
  isWorkspaceCurrent?: () => boolean;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const mounted = useRef(false),
    revision = useRef(0);
  const current = useCallback(
    () => mounted.current && (isWorkspaceCurrent?.() ?? true),
    [isWorkspaceCurrent],
  );
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    try {
      const value = await fetchEnquiryForwardingSettings(current);
      if (current() && request === revision.current) {
        setSettings(value);
        setError("");
      }
    } catch {
      if (current() && request === revision.current) setError("未能讀取查詢通知設定，請重新整理。");
    }
  }, [current]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);
  const copy = settings?.recipients.find((row) => row.kind === "copy");
  const readiness = settings?.recipientReadiness;
  const conflictKeys = new Set(readiness?.customerConflictRecipientKeys ?? []);
  const conflictPhones = new Map<string, Set<string>>();
  for (const row of settings?.recipients ?? []) {
    if (!conflictKeys.has(row.key)) continue;
    const phone = normalizePhone(row.phone) ?? row.phone;
    const names = conflictPhones.get(phone) ?? new Set<string>();
    names.add(row.name);
    conflictPhones.set(phone, names);
  }
  const blockedPhoneCount = Math.max(
    readiness?.distinctBlockedPhoneCount ?? 0,
    conflictPhones.size,
  );
  const hasIdentityConflicts = conflictKeys.size > 0 || blockedPhoneCount > 0;
  const identityReady =
    readiness?.checked === true &&
    readiness.distinctBlockedPhoneCount === 0 &&
    !hasIdentityConflicts;
  const canEnable = !error && settings?.providerCheck?.ready === true && identityReady;
  const providerReasons = [
    ...new Set(
      (settings?.providerCheck?.reasonCodes ?? []).map((code) =>
        code.includes("TEMPLATE")
          ? "未設定可用的已批核通知模板"
          : code.includes("CAPABILITY")
            ? "通知及回執核實尚未完成"
            : /SENDER|COMPANY_PHONE|COMPANY_CHANNEL|SCOPE_MISMATCH/.test(code)
              ? "公司發送號碼或渠道需要核對"
              : "WhatsApp 供應商連接需要核對",
      ),
    ),
  ];
  async function perform(kind: "check" | "toggle") {
    if (busy || !current() || (kind === "toggle" && !copy?.enabled && !canEnable)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (kind === "check") {
        await requestEnquiryForwardingCheck(current);
        if (current()) setNotice("正在核對 WhatsApp 連接，完成後按「更新」查看。");
      } else if (copy?.version) {
        await updateEnquiryForwardingEnabled(
          { enabled: !copy.enabled, expectedCopyVersion: copy.version },
          current,
        );
        if (current()) setNotice(copy.enabled ? "已暫停新查詢通知。" : "已啟用新查詢通知。");
      }
      await refresh();
    } catch {
      if (kind === "toggle" && current()) await refresh();
      if (current()) setError("未能更新，請核對連接、收件身份及設定是否已變更。");
    } finally {
      if (current()) setBusy(false);
    }
  }
  function recipients(rows: NonNullable<Settings>["recipients"]) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-2">收件人</th>
              <th className="p-2">WhatsApp</th>
              <th className="p-2">狀態</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b">
                <td className="p-2">{row.name}</td>
                <td className="p-2 tabular-nums">{row.phone.replace(/^852/, "+852 ")}</td>
                <td className="p-2">
                  {conflictKeys.has(row.key) ||
                  conflictPhones.has(normalizePhone(row.phone) ?? row.phone)
                    ? "客戶身份重疊"
                    : readiness?.checked !== true
                      ? "收件身份待核對"
                      : row.enabled && row.verified
                        ? "已啟用"
                        : row.verified
                          ? "已核對，未啟用"
                          : "待核對"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <section aria-label="查詢 WhatsApp 通知" className="space-y-4 rounded border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">查詢 WhatsApp 通知</h2>
        <Button variant="outline" disabled={busy} onClick={() => void refresh()}>
          更新
        </Button>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="font-medium">指定樓盤／單位</dt>
          <dd>負責 Sales ＋ 9798 7774</dd>
        </div>
        <div>
          <dt className="font-medium">只講屋苑</dt>
          <dd>屋苑主管 ＋ 9798 7774</dd>
        </div>
        <div>
          <dt className="font-medium">一般／待核對查詢</dt>
          <dd>只發 9798 7774</dd>
        </div>
      </dl>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!settings ? (
        <p>正在讀取…</p>
      ) : !settings.available ? (
        <p>查詢通知設定尚未就緒。</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">
              {settings.providerCheck?.ready
                ? "WhatsApp 連接及通知模板已核對"
                : "WhatsApp 連接及通知模板待核對"}
            </span>
            <Button variant="outline" disabled={busy} onClick={() => void perform("check")}>
              核對 WhatsApp 連接
            </Button>
            <Button
              disabled={busy || !copy?.version || (!copy.enabled && !canEnable)}
              onClick={() => void perform("toggle")}
            >
              {copy?.enabled ? "暫停新查詢通知" : "啟用新查詢通知"}
            </Button>
          </div>
          {!settings.providerCheck?.ready && providerReasons.length ? (
            <ul className="list-inside list-disc text-sm">
              {providerReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
          <div role="group" aria-label="收件身份核對" className="space-y-2 text-sm">
            {hasIdentityConflicts ? (
              <>
                <p>
                  {blockedPhoneCount > 0 ? `${blockedPhoneCount} 個收件號碼` : "收件號碼"}
                  與客戶身份重疊，請先核對。
                </p>
                <ul className="list-inside list-disc">
                  {[...conflictPhones].map(([phone, names]) => (
                    <li key={phone} className="break-words">
                      {[...names].join("、")} · {phone.replace(/^852/, "+852 ")}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>{identityReady ? "收件身份已核對" : "收件身份待核對，暫不能啟用通知。"}</p>
            )}
          </div>
          {recipients(settings.recipients.filter((row) => row.kind !== "sales"))}
          <details className="rounded border p-3">
            <summary className="cursor-pointer">
              樓盤 Sales 收件設定（
              {settings.recipients.filter((row) => row.kind === "sales").length}）
            </summary>
            {recipients(settings.recipients.filter((row) => row.kind === "sales"))}
          </details>
          <details className="rounded border p-3">
            <summary className="cursor-pointer">屋苑主管分配（{settings.routes.length}）</summary>
            <div className="grid gap-2 pt-3 text-sm sm:grid-cols-3">
              {settings.recipients
                .filter((row) => row.kind === "manager")
                .map((manager) => (
                  <div key={manager.key}>
                    <h3 className="font-medium">{manager.name}</h3>
                    <p>
                      {settings.routes
                        .filter((route) => route.enabled && route.managerKey === manager.key)
                        .map((route) => route.label)
                        .join("、")}
                    </p>
                  </div>
                ))}
            </div>
          </details>
          <div className="flex flex-wrap gap-4 text-sm">
            <span>待發 {settings.counts.queued ?? 0}</span>
            <span>已提交 {settings.counts.accepted ?? 0}</span>
            <span>已送達 {settings.counts.delivered ?? 0}</span>
            <span>待確認分派 {settings.counts.needs_review ?? 0}</span>
            <span>
              待處理{" "}
              {(settings.counts.suppressed ?? 0) +
                (settings.counts.failed ?? 0) +
                (settings.counts.unknown ?? 0)}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
