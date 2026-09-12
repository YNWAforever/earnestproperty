import { useEffect, useState } from "react";
import { fetchWhatsappServiceHealth } from "@/lib/neon/whatsapp-service-health";
import { Button } from "@/components/ui/button";
const labels: Record<string, string> = {
  opens: "連結開啟（不代表客戶）",
  enquiries: "收到查詢",
  attributable: "有來源憑證的查詢",
  confirmedAssignments: "已確認分派的對話",
  humanResponses: "有核實人手回覆的查詢",
  surveyAnswers: "已回答問卷",
};
export function WhatsappServiceHealth() {
  const [health, setHealth] = useState<Awaited<
      ReturnType<typeof fetchWhatsappServiceHealth>
    > | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
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
      .then((h) => {
        if (active) setHealth(h);
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
            模式：{health.mode} · 自動服務：
            {health.serviceEnabled ? "已設定開啟（仍須通過所有資格檢查）" : "關閉"} · 遷移：
            {health.schemaAvailable ? "已具備" : "未具備"}
          </p>
          <p className="text-sm">
            工作程序最後回報：{health.heartbeatAt ?? "未有證據"} · 最早到期工作：
            {health.oldestDueAt ?? "沒有已知到期工作"}
          </p>
          <p className="text-sm">
            分派未明 {health.routingUnknown} · 發送未明 {health.sendingUnknown} · 問卷受阻{" "}
            {health.blockedSurveys} · 未核實映射 {health.unverifiedStaff}
          </p>
          <p className="text-sm">
            {health.missingApproval ? "尚無生效的批准政策" : "已有生效政策；發布證據仍需獨立核對"}
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {Object.entries(health.counts).map(([k, v]) => (
              <div key={k} className="rounded bg-muted p-2 text-sm">
                {labels[k]}：{health.schemaAvailable ? v : "未有資料"}
              </div>
            ))}
          </div>
          {health.reasons.length ? (
            <ul className="text-xs text-muted-foreground">
              {health.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-muted-foreground">
            未知發送／分派不可直接重試；先核對供應商證據。以上數量分開計算，不代表廣告因果、睇樓或成交。
          </p>
        </>
      ) : null}
    </section>
  );
}
