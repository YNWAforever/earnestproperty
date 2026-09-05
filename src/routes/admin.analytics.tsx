import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AdminShell, AdminError } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchOperationalAnalytics } from "@/lib/analytics/reporting-client";
import { defaultAnalyticsDateRange, parseAnalyticsDateRange } from "@/lib/analytics/reporting";
import type { OperationalAnalyticsReport } from "@/lib/analytics/reporting";
export const Route = createFileRoute("/admin/analytics")({
  head: () => ({
    meta: [
      { title: "營運及轉換統計｜Earnest Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminAnalytics,
});
function AdminAnalytics() {
  const [range, setRange] = useState(defaultAnalyticsDateRange);
  const [requested, setRequested] = useState(range);
  const [revision, setRevision] = useState(0);
  const [report, setReport] = useState<OperationalAnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReport(null);
    fetchOperationalAnalytics(requested)
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(
            reason?.status === 403 || reason?.status === 401
              ? "需要管理員或主管權限，請重新登入或聯絡管理員。"
              : "未能載入統計，請稍後再試。",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requested, revision]);
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      setRequested(parseAnalyticsDateRange(range));
      setRevision((v) => v + 1);
    } catch {
      setError("請選擇有效日期，最多 90 日。");
    }
  }
  return (
    <AdminShell title="營運及轉換統計" description="香港時間每日匯總，只顯示數量，不載入客戶明細。">
      <div className="space-y-6">
        <Button asChild variant="outline">
          <Link to="/admin/operations">返回系統營運</Link>
        </Button>
        <form
          onSubmit={submit}
          className="flex flex-wrap items-end gap-3"
          aria-label="統計日期範圍"
        >
          <div>
            <Label htmlFor="analytics-start">開始日期</Label>
            <Input
              id="analytics-start"
              type="date"
              value={range.start}
              onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
              required
            />
          </div>
          <div>
            <Label htmlFor="analytics-end">結束日期</Label>
            <Input
              id="analytics-end"
              type="date"
              value={range.end}
              onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
              required
            />
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? "載入中…" : "更新統計"}
          </Button>
          <p className="text-sm text-muted-foreground">最多 90 日，包括開始及結束日。</p>
        </form>
        {error ? <AdminError message={error} /> : null}
        {loading ? <Skeleton className="h-56 w-full" /> : null}
        {report ? (
          <>
            <section aria-labelledby="analytics-operations-title" className="space-y-3">
              <h2 id="analytics-operations-title" className="text-lg font-semibold">
                期間建立的查詢及跟進
              </h2>
              <p className="text-sm text-muted-foreground">
                {report.range.start} 至 {report.range.end}
                。分配及關閉狀態為目前狀態；查詢、銷售線索和對話是不同記錄，不能相加當作客戶人數。
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="客戶查詢" value={report.summary.inquiries} />
                <Metric label="已連結銷售線索的查詢" value={report.summary.linkedLeads} />
                <Metric label="銷售線索" value={report.summary.leads} />
                <Metric label="WhatsApp 對話" value={report.summary.conversations} />
                <Metric label="未分配查詢" value={report.summary.unassignedInquiries} />
                <Metric label="未分配銷售線索" value={report.summary.unassignedLeads} />
                <Metric label="未分配對話" value={report.summary.unassignedConversations} />
                <Metric label="未關閉對話" value={report.summary.openConversations} />
              </div>
            </section>
            <section aria-labelledby="analytics-ga4-title" className="rounded border p-4">
              <h2 id="analytics-ga4-title" className="font-semibold">
                GA4 流量及轉換報表未接駁
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                瀏覽量、WhatsApp 點擊及網站轉換事件暫未有資料，並非
                0。此頁的查詢數量直接來自營運記錄；GA4 資料接駁完成後才可比較流量及轉換。
              </p>
            </section>
            <section aria-labelledby="analytics-daily-title">
              <h2 id="analytics-daily-title" className="mb-3 font-semibold">
                每日建立數量
              </h2>
              <div className="overflow-x-auto rounded border">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    香港時間每日客戶查詢、線索連結、銷售線索及 WhatsApp 對話數量
                  </caption>
                  <thead>
                    <tr className="border-b bg-muted text-left">
                      <th scope="col" className="p-3">
                        日期
                      </th>
                      <th scope="col" className="p-3">
                        查詢
                      </th>
                      <th scope="col" className="p-3">
                        已連結線索
                      </th>
                      <th scope="col" className="p-3">
                        銷售線索
                      </th>
                      <th scope="col" className="p-3">
                        對話
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.days.map((day) => (
                      <tr key={day.day} className="border-b last:border-0">
                        <th scope="row" className="whitespace-nowrap p-3 font-normal">
                          {day.day}
                        </th>
                        <td className="p-3">{day.inquiries}</td>
                        <td className="p-3">{day.linkedLeads}</td>
                        <td className="p-3">{day.leads}</td>
                        <td className="p-3">{day.conversations}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </AdminShell>
  );
}
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value.toLocaleString("zh-HK")}</p>
    </div>
  );
}
