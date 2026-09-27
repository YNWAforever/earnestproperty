import { useEffect, useState } from "react";
import { fetchWhatsappServiceHealth } from "@/lib/neon/whatsapp-service-health";
import { Button } from "@/components/ui/button";

const labels: Record<string, string> = {
  opens: "連結開啟（不代表查詢）",
  enquiries: "已關聯客戶查詢",
  attributable: "有來源憑證的查詢",
  confirmedAssignments: "已確認分派的對話",
  humanResponses: "已核實真人首回覆",
  surveyAnswers: "已回答問卷",
};
const state = (value: string) =>
  value === "ready" ? "就緒" : value === "blocked" ? "受阻" : "未核實";

export function WhatsappServiceHealth() {
  const [health, setHealth] = useState<Awaited<
    ReturnType<typeof fetchWhatsappServiceHealth>
  > | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function refresh() {
    setLoading(true);
    try {
      setHealth(await fetchWhatsappServiceHealth());
      setError("");
    } catch {
      setError("未能載入服務狀態；需要管理員或經理權限。");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    fetchWhatsappServiceHealth()
      .then((value) => {
        if (active) setHealth(value);
      })
      .catch(() => {
        if (active) setError("未能載入服務狀態；需要管理員或經理權限。");
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="my-4 space-y-3 rounded border p-4" aria-label="WhatsApp 服務健康">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">WhatsApp 服務流程</h2>
        <Button variant="outline" disabled={loading} onClick={() => void refresh()}>
          更新服務狀態
        </Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {health ? (
        <>
          <p>
            模式：{health.mode} · 自動服務：{health.serviceEnabled ? "已設定開啟" : "關閉"} ·
            必要資料表：{health.schemaAvailable ? "已具備" : "缺失，服務受阻"}
          </p>
          <p className="text-sm">
            接單分派：{state(health.runtime.assignment.state)} · 客戶回覆：
            {state(health.runtime.customerReply.state)} · 同事 WhatsApp 文字：
            {state(health.runtime.staffWhatsappText.state)} · 同事模板：
            {state(health.runtime.staffWhatsappTemplate.state)}
          </p>
          <p className="text-sm">
            生效政策：
            {health.policy.version == null
              ? "沒有已批准且生效的版本"
              : `v${health.policy.version} · ${health.policy.purpose ?? "未註明用途"} · ${health.policy.timezone ?? "時區未核實"}`}
            ；工作容許延遲：
            {health.policy.workerLagSeconds == null
              ? "未設定"
              : `${health.policy.workerLagSeconds} 秒`}
          </p>
          <p className="text-sm">
            接單分派就緒：
            {health.coverage
              ? `${health.coverage.assignmentReadyStaff}/${health.coverage.eligibleStaff}`
              : "未能核實"}{" "}
            · 同事手機通知就緒：
            {health.coverage
              ? `${health.coverage.staffWhatsappReadyStaff}/${health.coverage.eligibleStaff}`
              : "未能核實"}{" "}
            · 缺 Inbox 映射：{health.coverage?.missingMappingStaff ?? "未能核實"}
          </p>
          <p className="text-xs text-muted-foreground">
            分母範圍：{health.coverage?.scope ?? "就緒資料未取得"}。手機通知不等同 Inbox
            分派或私人備註。
          </p>
          <p className="text-xs text-muted-foreground">
            追蹤連結限流：每條已註冊連結 {health.redirectCapacity.registeredPerLinkPerMinute}/分鐘；
            全域固定 {health.redirectCapacity.globalShards} 個分區，每分區{" "}
            {health.redirectCapacity.globalPerShardPerMinute}/分鐘。超限時追蹤狀態為 untracked。
          </p>
          <p className="text-sm">
            已到期工作：{health.overdueJobs} · 過期租約：{health.expiredLeases} · 最早到期：
            {health.oldestDueAt ?? "沒有"} · 下次排程：{health.nextWakeAt ?? "沒有"}
          </p>
          <p className="text-sm">
            工作程序最後回報：{health.heartbeatAt ?? "未有證據"} · 最近成功：
            {health.lastSuccessAt ?? "未有證據"}
          </p>
          <p className="text-sm">
            分派未明 {health.routingUnknown} · 發送未明 {health.sendingUnknown} · 問卷受阻{" "}
            {health.blockedSurveys}
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {Object.entries(health.counts).map(([key, value]) => (
              <div key={key} className="rounded bg-muted p-2 text-sm">
                {labels[key]}：{health.schemaAvailable ? value : "未有資料"}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            真人首回覆樣本 {health.measurement.humanResponseSample}；時區{" "}
            {health.measurement.timezone}；排除
            spam、測試、機械人回覆及未關聯對話。開啟、查詢、分派和真人回覆分開計算。
          </p>
          {health.reasons.length ? (
            <ul className="text-xs text-destructive">
              {health.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-muted-foreground">
            未知發送／分派先核對供應商證據，不直接重試；供應商接受不等於手機送達。
          </p>
        </>
      ) : null}
    </section>
  );
}
