import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { parsePerformanceFilters } from "@/lib/analytics/sales-performance.mjs";
import type {
  PerformanceFilterOptions,
  PerformanceFilters,
  PerformanceMetric,
  PerformanceReport,
} from "@/lib/analytics/sales-performance.types";

type Props = {
  filters: PerformanceFilters;
  report: PerformanceReport | null;
  options: PerformanceFilterOptions | null;
  loading?: boolean;
  error?: string | null;
  onApplyFilters: (filters: PerformanceFilters) => void;
  onOpenRecords: (key: string) => void;
};
function formatMetric(m: PerformanceMetric) {
  if (m.value === null) return "未有足夠資料";
  const n = Number(m.value);
  if (m.unit === "ratio")
    return (n * 100).toLocaleString("zh-HK", { maximumFractionDigits: 1 }) + "%";
  if (m.unit === "HKD")
    return (
      "HK$" + n.toLocaleString("zh-HK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    );
  if (m.unit === "minutes")
    return n.toLocaleString("zh-HK", { maximumFractionDigits: 1 }) + " 分鐘";
  return n.toLocaleString("zh-HK");
}
function MetricCard({
  label,
  metric,
  definition,
  onOpenRecords,
}: {
  label: string;
  metric: PerformanceMetric;
  definition?: string;
  onOpenRecords: (key: string) => void;
}) {
  return (
    <div className="rounded-lg border bg-card p-4" title={definition}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
        {metric.status === "provisional" ? (
          <span className="rounded bg-amber-100 px-2 text-xs text-amber-900">暫定</span>
        ) : null}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{formatMetric(metric)}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        樣本 {metric.sampleSize === null ? "未知" : metric.sampleSize.toLocaleString("zh-HK")}
        {metric.denominator === null ? "" : "／分母 " + metric.denominator.toLocaleString("zh-HK")}
      </p>
      {metric.drilldownKey && metric.status !== "unavailable" ? (
        <Button
          type="button"
          variant="link"
          className="mt-1 h-auto px-0 text-sm"
          onClick={() => onOpenRecords(metric.drilldownKey!)}
        >
          可查看記錄
        </Button>
      ) : null}
    </div>
  );
}
const emptyOptions: PerformanceFilterOptions = { canCorrect: false, branches: [], staff: [] };
export function PerformanceDashboard({
  filters,
  report,
  options,
  loading = false,
  error = null,
  onApplyFilters,
  onOpenRecords,
}: Props) {
  const [draft, setDraft] = useState<PerformanceFilters>(filters);
  const [filterError, setFilterError] = useState<string | null>(null);
  useEffect(() => setDraft(filters), [filters]);
  const available = options ?? emptyOptions;
  const staff = available.staff.filter(
    (person) => !draft.branchId || person.branchId === draft.branchId,
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      onApplyFilters(parsePerformanceFilters(draft));
      setFilterError(null);
    } catch {
      setFilterError("篩選條件無效，請檢查日期及選項。");
    }
  }
  const card = (label: string, m: PerformanceMetric, key: string) => (
    <MetricCard
      label={label}
      metric={m}
      definition={report?.definitions[key]}
      onOpenRecords={onOpenRecords}
    />
  );
  return (
    <section aria-labelledby="performance-title" className="space-y-5 border-t pt-8">
      <div>
        <h2 id="performance-title" className="text-xl font-semibold">
          銷售及代理績效
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          以香港日期及已核實來源計算；未知、測試及垃圾資料另列。成交額與應收佣金分開顯示。
        </p>
      </div>
      <form
        aria-label="績效篩選"
        onSubmit={submit}
        className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div>
          <Label htmlFor="performance-start">開始日期</Label>
          <Input
            id="performance-start"
            type="date"
            value={draft.start}
            onChange={(e) => setDraft((v) => ({ ...v, start: e.target.value }))}
            required
          />
        </div>
        <div>
          <Label htmlFor="performance-end">結束日期</Label>
          <Input
            id="performance-end"
            type="date"
            value={draft.end}
            onChange={(e) => setDraft((v) => ({ ...v, end: e.target.value }))}
            required
          />
        </div>
        <div>
          <Label htmlFor="performance-branch">分行</Label>
          <select
            id="performance-branch"
            className="h-10 w-full rounded-md border bg-background px-3"
            value={draft.branchId ?? ""}
            onChange={(e) =>
              setDraft((v) => ({ ...v, branchId: e.target.value || null, staffId: null }))
            }
          >
            <option value="">全部可見分行</option>
            {available.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="performance-staff">同事</Label>
          <select
            id="performance-staff"
            className="h-10 w-full rounded-md border bg-background px-3"
            value={draft.staffId ?? ""}
            onChange={(e) => setDraft((v) => ({ ...v, staffId: e.target.value || null }))}
          >
            <option value="">全部可見同事</option>
            {staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="performance-source">查詢來源</Label>
          <select
            id="performance-source"
            className="h-10 w-full rounded-md border bg-background px-3"
            value={draft.source ?? ""}
            onChange={(e) =>
              setDraft((v) => ({
                ...v,
                source: (e.target.value || null) as PerformanceFilters["source"],
              }))
            }
          >
            <option value="">全部來源</option>
            {["website", "whatsapp", "28hse", "youtube", "other", "unknown"].map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="performance-deal">租售</Label>
          <select
            id="performance-deal"
            className="h-10 w-full rounded-md border bg-background px-3"
            value={draft.dealType ?? ""}
            onChange={(e) =>
              setDraft((v) => ({
                ...v,
                dealType: (e.target.value || null) as PerformanceFilters["dealType"],
              }))
            }
          >
            <option value="">租售全部</option>
            <option value="sale">買賣</option>
            <option value="rent">租賃</option>
          </select>
        </div>
        <div>
          <Label htmlFor="performance-window">轉換觀察期</Label>
          <select
            id="performance-window"
            className="h-10 w-full rounded-md border bg-background px-3"
            value={draft.cohortWindowDays}
            onChange={(e) =>
              setDraft((v) => ({ ...v, cohortWindowDays: Number(e.target.value) as 30 | 90 }))
            }
          >
            <option value={30}>30 日</option>
            <option value={90}>90 日</option>
          </select>
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={loading}>
            套用篩選
          </Button>
        </div>
        {filterError ? (
          <p role="alert" className="text-sm text-destructive sm:col-span-2 lg:col-span-4">
            {filterError}
          </p>
        ) : null}
      </form>
      {error ? (
        <p role="alert" className="rounded border border-destructive p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p role="status" className="text-sm">
          載入績效中…
        </p>
      ) : null}
      {report ? (
        <>
          <p className="text-sm text-muted-foreground">
            更新於 {new Date(report.asOf).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}
            。轉換按查詢建立日期分組，當前待辦按現時狀態計。
          </p>
          <Tabs defaultValue="acquisition" className="space-y-4">
            <TabsList className="flex h-auto flex-wrap justify-start">
              <TabsTrigger value="acquisition">新增與轉換</TabsTrigger>
              <TabsTrigger value="followup">回覆及跟進</TabsTrigger>
              <TabsTrigger value="sales">成交及佣金</TabsTrigger>
              <TabsTrigger value="backlog">當前待辦</TabsTrigger>
            </TabsList>
            <TabsContent value="acquisition" forceMount className="data-[state=inactive]:hidden">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {card("有效查詢", report.acquisition.inquiries, "inquiries")}
                {card("唯一客戶", report.acquisition.uniqueCustomers, "uniqueCustomers")}
                {card("合格線索", report.acquisition.qualifiedLeads, "qualifiedLeads")}
                {card("完成看樓", report.acquisition.completedViewings, "completedViewings")}
                {card("30／90 日成交轉換", report.acquisition.saleConversion, "saleConversion")}
              </div>
            </TabsContent>
            <TabsContent value="followup" forceMount className="data-[state=inactive]:hidden">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {card("已確認分配", report.followup.confirmedAssignments, "confirmedAssignments")}
                {card("首回覆中位數", report.followup.responseMedianMinutes, "responseMinutes")}
                {card("首回覆 P90", report.followup.responseP90Minutes, "responseMinutes")}
                {card("未回覆", report.followup.unanswered, "responseMinutes")}
                {card("逾期未回覆", report.followup.overdue, "responseMinutes")}
                {card("政策時間內回覆", report.followup.businessSla, "businessSla")}
              </div>
            </TabsContent>
            <TabsContent value="sales" forceMount className="data-[state=inactive]:hidden">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {card("已核實成交", report.sales.deals, "deals")}
                {card("買賣成交額", report.sales.saleValue, "saleValue")}
                {card("應收佣金", report.sales.commissionReceivable, "commissionReceivable")}
              </div>
              <h3 className="mt-6 mb-2 font-semibold">代理績效</h3>
              <div className="overflow-x-auto rounded border">
                <table className="w-full min-w-[740px] text-sm">
                  <caption className="sr-only">代理有效查詢、跟進、加權成交額及應收佣金</caption>
                  <thead>
                    <tr className="border-b bg-muted text-left">
                      {[
                        ["同事", "agentCredits"],
                        ["有效查詢", "inquiries"],
                        ["合格線索", "qualifiedLeads"],
                        ["完成看樓", "completedViewings"],
                        ["真人回覆", "responseMinutes"],
                        ["成交宗數", "deals"],
                        ["加權成交額", "agentCredits"],
                        ["應收佣金", "commissionReceivable"],
                        ["佣金樣本", "commissionReceivable"],
                      ].map(([label, definitionKey]) => (
                        <th
                          key={label}
                          scope="col"
                          className="p-3"
                          title={report.definitions[definitionKey]}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.agents.length ? (
                      report.agents.map((agent) => (
                        <tr key={agent.staffId} className="border-b">
                          <th scope="row" className="p-3 font-medium">
                            {available.staff.find((s) => s.id === agent.staffId)?.name ??
                              agent.staffId}
                          </th>
                          <td className="p-3">{agent.inquiries}</td>
                          <td className="p-3">{agent.qualifiedLeads}</td>
                          <td className="p-3">{agent.completedViewings}</td>
                          <td className="p-3">{agent.humanResponses}</td>
                          <td className="p-3">{agent.deals}</td>
                          <td className="p-3">
                            {"HK$" + Number(agent.weightedSaleValue).toLocaleString("zh-HK")}
                          </td>
                          <td className="p-3">
                            {agent.commissionReceivable === null
                              ? "未知"
                              : "HK$" + Number(agent.commissionReceivable).toLocaleString("zh-HK")}
                          </td>
                          <td className="p-3">{agent.commissionSampleSize}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={9} className="p-5 text-muted-foreground">
                          此範圍未有可歸因的代理記錄。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {report.definitions.agentCredits}
              </p>
            </TabsContent>
            <TabsContent value="backlog" forceMount className="data-[state=inactive]:hidden">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {card("現時未結查詢", report.backlog.openInquiries, "backlog")}
                {card("品質未明待辦", report.backlog.unknownQuality, "quality")}
              </div>
            </TabsContent>
          </Tabs>
          <section
            aria-labelledby="performance-quality"
            className="space-y-3 rounded-lg border p-4"
          >
            <h3 id="performance-quality" className="font-semibold">
              資料品質
            </h3>
            <p className="text-sm text-muted-foreground">{report.definitions.quality}</p>
            <div className="flex flex-wrap gap-2 text-sm">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenRecords("quality_unknown_inquiries")}
              >
                未知查詢 {report.qualityCoverage.inquiries.unknown}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenRecords("quality_test_inquiries")}
              >
                測試 {report.qualityCoverage.inquiries.test}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenRecords("quality_spam_inquiries")}
              >
                垃圾 {report.qualityCoverage.inquiries.spam}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenRecords("quality_unknown_events")}
              >
                未知跟進事件 {report.qualityCoverage.events.unknown}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenRecords("quality_test_events")}
              >
                測試跟進 {report.qualityCoverage.events.test}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenRecords("quality_spam_events")}
              >
                垃圾跟進 {report.qualityCoverage.events.spam}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenRecords("quality_unknown_deals")}
              >
                未知成交 {report.qualityCoverage.deals.unknown}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenRecords("quality_test_deals")}
              >
                測試成交 {report.qualityCoverage.deals.test}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenRecords("quality_spam_deals")}
              >
                垃圾成交 {report.qualityCoverage.deals.spam}
              </Button>
              <span className="rounded border px-3 py-2">
                未歸因歷史成交 {report.qualityCoverage.deals.unattributed}
              </span>
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
