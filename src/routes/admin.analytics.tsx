import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AdminShell, AdminError } from "@/components/admin/AdminShell";
import { useStaffSession } from "@/components/admin/staff-session";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { PerformanceDashboard } from "@/components/admin/analytics/PerformanceDashboard";
import { PerformanceTable } from "@/components/admin/analytics/PerformanceTable";
import {
  correctInquiryQuality,
  correctPerformanceEventQuality,
  fetchPerformanceFilterOptions,
  fetchSalesPerformance,
  fetchSalesPerformanceRecords,
  qualifyPerformanceLead,
} from "@/lib/analytics/sales-performance-client";
import { ServerFnResponseError } from "@/lib/neon/server-fn-response";
import { parsePerformanceFilters } from "@/lib/analytics/sales-performance.mjs";
import { parsePerformanceSearch as parsePerformanceSearchInput } from "@/lib/analytics/performance-route-search.mjs";
import type {
  PerformanceFilterOptions,
  PerformanceFilters,
  PerformanceRecord,
  PerformanceRecordPage,
  PerformanceReport,
} from "@/lib/analytics/sales-performance.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchOperationalAnalytics } from "@/lib/analytics/reporting-client";
import { defaultAnalyticsDateRange, parseAnalyticsDateRange } from "@/lib/analytics/reporting";
import type { OperationalAnalyticsReport } from "@/lib/analytics/reporting";
function parsePerformanceSearch(search: Record<string, unknown>) {
  return parsePerformanceSearchInput(search, defaultAnalyticsDateRange());
}
export const Route = createFileRoute("/admin/analytics")({
  validateSearch: parsePerformanceSearch,
  head: () => ({
    meta: [
      { title: "營運及轉換統計｜Earnest Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminAnalytics,
});
function AdminAnalytics() {
  const { user } = useNeonAuth();
  const { session } = useStaffSession(user?.id ?? null);
  const identity =
    user && session?.status === "ok"
      ? JSON.stringify([user.id, session.staffId, [...session.roles].sort()])
      : null;
  if (
    !identity ||
    session?.status !== "ok" ||
    !session.roles.some((role) => role === "admin" || role === "manager")
  )
    return (
      <AdminShell
        title="營運及轉換統計"
        description="香港時間每日匯總，只顯示數量，不載入客戶明細。"
      >
        {identity ? (
          <AdminError message="需要管理員或主管權限，請聯絡管理員。" />
        ) : (
          <Skeleton className="h-56 w-full" />
        )}
      </AdminShell>
    );
  return <AdminAnalyticsWorkspace key={identity} />;
}
function AdminAnalyticsWorkspace() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const performanceFilters: PerformanceFilters = useMemo(
    () => ({
      start: search.start,
      end: search.end,
      branchId: search.branchId,
      staffId: search.staffId,
      source: search.source,
      dealType: search.dealType,
      cohortWindowDays: search.cohortWindowDays,
    }),
    [
      search.start,
      search.end,
      search.branchId,
      search.staffId,
      search.source,
      search.dealType,
      search.cohortWindowDays,
    ],
  );
  const [performance, setPerformance] = useState<PerformanceReport | null>(null);
  const [performanceOptions, setPerformanceOptions] = useState<PerformanceFilterOptions | null>(
    null,
  );
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [performanceError, setPerformanceError] = useState<string | null>(null);
  const [drilldownKey, setDrilldownKey] = useState<string | null>(null);
  const [recordPage, setRecordPage] = useState<PerformanceRecordPage | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const recordRequest = useRef(0);
  const currentRecordsReadback = useRef<(() => Promise<void>) | null>(null);
  const qualificationRequests = useRef(
    new Map<string, { leadId: string; qualifiedAt: string; evidence: string }>(),
  );
  const qualityRequests = useRef(
    new Map<
      string,
      {
        expectedRevisionId: string | null;
        quality: "production" | "test" | "spam" | "unknown";
        reason: string;
      }
    >(),
  );
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const requests = recordRequest;
    return () => {
      active.current = false;
      requests.current++;
    };
  }, []);
  const [performanceRevision, setPerformanceRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetchPerformanceFilterOptions()
      .then((value) => {
        if (!cancelled) setPerformanceOptions(value);
      })
      .catch(() => {
        if (!cancelled) setPerformanceOptions(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    recordRequest.current++;
    currentRecordsReadback.current = null;
    setDrilldownKey(null);
    setRecordPage(null);
  }, [performanceFilters]);
  useEffect(() => {
    if (search.invalidFilter) {
      setPerformance(null);
      setPerformanceLoading(false);
      setPerformanceError("網址中的篩選條件無效，請清除後重試。");
      return;
    }
    let cancelled = false;
    setPerformanceLoading(true);
    setPerformance(null);
    setPerformanceError(null);
    fetchSalesPerformance(performanceFilters)
      .then((value) => {
        if (!cancelled) setPerformance(value);
      })
      .catch(() => {
        if (!cancelled) {
          setPerformance(null);
          setPerformanceError("未能載入績效，請檢查權限或稍後再試。");
        }
      })
      .finally(() => {
        if (!cancelled) setPerformanceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [performanceFilters, performanceRevision, search.invalidFilter]);
  async function openRecords(key: string, cursor: string | null = null, append = false) {
    if (!active.current || search.invalidFilter) return;
    currentRecordsReadback.current = () => openRecords(key);
    const requestId = ++recordRequest.current;
    setDrilldownKey(key);
    setRecordsLoading(true);
    setRecordsError(null);
    if (!append) setRecordPage(null);
    try {
      const next = await fetchSalesPerformanceRecords({
        filters: performanceFilters,
        drilldownKey: key,
        cursor,
      });
      if (requestId !== recordRequest.current) return;
      for (const record of next.records) {
        if (!record.leadId || !record.qualification) continue;
        const pending = qualificationRequests.current.get(record.leadId);
        const source = record.qualification;
        if (
          pending &&
          pending.evidence === source.evidence &&
          new Date(pending.qualifiedAt).getTime() === new Date(source.qualifiedAt).getTime() &&
          source.eventKey === `lead_qualified:${pending.leadId}`
        )
          qualificationRequests.current.delete(record.leadId);
      }
      setRecordPage((current) =>
        append && current
          ? { records: [...current.records, ...next.records], nextCursor: next.nextCursor }
          : next,
      );
    } catch {
      if (requestId === recordRequest.current) setRecordsError("未能載入對應記錄，請重試。");
    } finally {
      if (requestId === recordRequest.current) setRecordsLoading(false);
    }
  }
  async function refreshAfterMutation() {
    if (!active.current) return;
    setPerformanceRevision((v) => v + 1);
    await currentRecordsReadback.current?.();
  }
  async function correctQuality(input: {
    record: PerformanceRecord;
    quality: "production" | "test" | "spam" | "unknown";
    reason: string;
  }) {
    const key =
      input.record.kind === "inquiry"
        ? `inquiry:${input.record.id}`
        : input.record.eventKey
          ? `event:${input.record.eventKey}`
          : null;
    if (!key || input.record.qualityRevisionId === undefined)
      throw new Error("Reload the quality source snapshot before correcting");
    const reason = input.reason.trim();
    const previous = qualityRequests.current.get(key);
    if (previous && (previous.quality !== input.quality || previous.reason !== reason)) {
      const error = new Error("Restore the original quality decision before retrying");
      error.name = "QualityRequestChanged";
      throw error;
    }
    // The actor-keyed workspace keeps the first snapshot through unknown outcomes
    // and filter remounts. A newer source read must not replace that original base.
    const request = previous ?? {
      expectedRevisionId: input.record.qualityRevisionId,
      quality: input.quality,
      reason,
    };
    qualityRequests.current.set(key, request);
    try {
      if (input.record.kind === "inquiry")
        await correctInquiryQuality({ inquiryId: input.record.id, ...request });
      else await correctPerformanceEventQuality({ eventKey: input.record.eventKey!, ...request });
    } catch (error) {
      const conflict = error instanceof ServerFnResponseError && error.status === 409;
      // This quality writer returns409 only when the exact immutable successor
      // was not accepted. Revoked authority or invalid input cannot prove that.
      if (
        (conflict ||
          (!previous &&
            error instanceof ServerFnResponseError &&
            [400, 403].includes(error.status))) &&
        qualityRequests.current.get(key) === request
      )
        qualityRequests.current.delete(key);
      if (conflict) await refreshAfterMutation();
      throw error;
    }
    if (qualityRequests.current.get(key) === request) qualityRequests.current.delete(key);
    await refreshAfterMutation();
  }
  async function qualifyLead(input: { leadId: string; qualifiedAt: string; evidence: string }) {
    const evidence = input.evidence.trim();
    const previous = qualificationRequests.current.get(input.leadId);
    if (previous && previous.evidence !== evidence) {
      const error = new Error("Restore the original qualification evidence before retrying");
      error.name = "QualificationRequestChanged";
      throw error;
    }
    // Keep the original request through uncertainty and table/filter remounts.
    // The actor-keyed workspace discards this journal when identity changes.
    const request = previous ?? { ...input, evidence };
    qualificationRequests.current.set(input.leadId, request);
    try {
      await qualifyPerformanceLead(request);
    } catch (error) {
      // A first definite refusal did not accept this request. A later refusal
      // cannot disprove an earlier uncertain commit, so retain that journal.
      if (
        !previous &&
        error instanceof ServerFnResponseError &&
        [400, 403, 409].includes(error.status) &&
        qualificationRequests.current.get(input.leadId) === request
      )
        qualificationRequests.current.delete(input.leadId);
      throw error;
    }
    if (qualificationRequests.current.get(input.leadId) === request)
      qualificationRequests.current.delete(input.leadId);
    await refreshAfterMutation();
  }
  function applyPerformanceFilters(next: PerformanceFilters) {
    recordRequest.current++;
    currentRecordsReadback.current = null;
    setDrilldownKey(null);
    setRecordPage(null);
    void navigate({ search: parsePerformanceFilters(next) });
  }
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
        {search.invalidFilter ? (
          <div className="rounded border border-destructive p-3">
            <AdminError message="網址中的績效篩選無效。報表未載入，以免擴大查詢範圍。" />
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void navigate({
                  search: parsePerformanceFilters({
                    ...defaultAnalyticsDateRange(),
                    cohortWindowDays: 90,
                  }),
                })
              }
            >
              清除網址篩選
            </Button>
          </div>
        ) : null}
        <>
          <PerformanceDashboard
            filters={performanceFilters}
            report={performance}
            options={performanceOptions}
            loading={performanceLoading}
            error={performanceError}
            onApplyFilters={applyPerformanceFilters}
            onOpenRecords={(key) => void openRecords(key)}
          />
          {drilldownKey ? (
            <PerformanceTable
              drilldownKey={drilldownKey}
              page={recordPage}
              canCorrect={performanceOptions?.canCorrect ?? false}
              canQualify={performanceOptions !== null}
              loading={recordsLoading}
              error={recordsError}
              onClose={() => {
                recordRequest.current++;
                currentRecordsReadback.current = null;
                setDrilldownKey(null);
                setRecordPage(null);
              }}
              onMore={() => void openRecords(drilldownKey, recordPage?.nextCursor ?? null, true)}
              onCorrect={correctQuality}
              onQualify={qualifyLead}
              getPendingQualityDecision={(record) =>
                qualityRequests.current.get(
                  record.kind === "inquiry" ? `inquiry:${record.id}` : `event:${record.eventKey}`,
                )
              }
              getPendingQualificationEvidence={(leadId) =>
                qualificationRequests.current.get(leadId)?.evidence
              }
            />
          ) : null}
        </>
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
