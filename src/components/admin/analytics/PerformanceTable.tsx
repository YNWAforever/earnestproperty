import { useState } from "react";
import { safePerformanceCsvCell } from "@/lib/analytics/performance-csv";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  PerformanceRecord,
  PerformanceRecordPage,
} from "@/lib/analytics/sales-performance.types";

type Props = {
  drilldownKey: string;
  page: PerformanceRecordPage | null;
  canCorrect: boolean;
  canQualify: boolean;
  loading: boolean;
  error?: string | null;
  onClose: () => void;
  onMore: () => void;
  onQualify: (input: { leadId: string; qualifiedAt: string; evidence: string }) => Promise<void>;
  onCorrect: (input: {
    record: PerformanceRecord;
    quality: "production" | "test" | "spam" | "unknown";
    reason: string;
  }) => Promise<void>;
};
function exportVisible(page: PerformanceRecordPage) {
  const headers = ["kind", "id", "occurredAt", "quality", "staffId", "leadId", "transactionId"];
  const lines = [
    headers.join(","),
    ...page.records.map((record) =>
      headers
        .map((key) => safePerformanceCsvCell(String(record[key as keyof PerformanceRecord] ?? "")))
        .join(","),
    ),
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "performance-visible-page.csv";
  link.click();
  URL.revokeObjectURL(url);
}
export function PerformanceTable({
  drilldownKey,
  page,
  canCorrect,
  canQualify,
  loading,
  error = null,
  onClose,
  onMore,
  onCorrect,
  onQualify,
}: Props) {
  const [quality, setQuality] = useState<"production" | "test" | "spam" | "unknown">("unknown");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [qualificationEvidence, setQualificationEvidence] = useState("");
  async function save(event: FormEvent, record: PerformanceRecord) {
    event.preventDefault();
    if (editingId !== record.id) {
      setSaveError("請重新開啟此記錄的修正表單。");
      return;
    }
    if (reason.trim().length < 8) {
      setSaveError("修正原因最少 8 個字。");
      return;
    }
    setSaving(record.id);
    setSaveError(null);
    try {
      await onCorrect({ record, quality, reason: reason.trim() });
      setReason("");
    } catch {
      setSaveError("未能儲存品質修正，請重試。");
    } finally {
      setSaving(null);
    }
  }
  async function qualify(event: FormEvent, record: PerformanceRecord) {
    event.preventDefault();
    if (!record.leadId || editingId !== record.id || qualificationEvidence.trim().length < 8) {
      setSaveError("請提供至少 8 個字的核實依據。");
      return;
    }
    setSaving(record.id);
    setSaveError(null);
    try {
      await onQualify({
        leadId: record.leadId,
        qualifiedAt: new Date().toISOString(),
        evidence: qualificationEvidence.trim(),
      });
      setQualificationEvidence("");
    } catch {
      setSaveError("未能核實線索；請確認狀態、權限及是否已完成核實。");
    } finally {
      setSaving(null);
    }
  }
  return (
    <section
      aria-labelledby="performance-records-title"
      className="space-y-3 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="performance-records-title" className="font-semibold">
            對應記錄
          </h3>
          <p className="text-xs text-muted-foreground">
            {drilldownKey}；只顯示目前權限及篩選範圍內的資料。
          </p>
        </div>
        <div className="flex gap-2">
          {page?.records.length ? (
            <Button type="button" variant="outline" onClick={() => exportVisible(page)}>
              匯出本頁 CSV
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={onClose}>
            關閉
          </Button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {saveError ? (
        <p role="alert" className="text-sm text-destructive">
          {saveError}
        </p>
      ) : null}
      {loading ? (
        <p role="status" className="text-sm">
          載入對應記錄中…
        </p>
      ) : null}
      {page && !page.records.length ? (
        <p className="text-sm text-muted-foreground">這項指標目前沒有可顯示的記錄。</p>
      ) : null}
      {page?.records.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">與所選績效指標相符的記錄</caption>
            <thead>
              <tr className="border-b bg-muted text-left">
                <th scope="col" className="p-2">
                  類型
                </th>
                <th scope="col" className="p-2">
                  記錄
                </th>
                <th scope="col" className="p-2">
                  時間
                </th>
                <th scope="col" className="p-2">
                  品質
                </th>
                <th scope="col" className="p-2">
                  同事
                </th>
                {canCorrect || canQualify ? (
                  <th scope="col" className="p-2">
                    管理操作
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {page.records.map((record) => (
                <tr key={record.kind + record.id} className="border-b align-top">
                  <td className="p-2">{record.kind}</td>
                  <th
                    scope="row"
                    className="max-w-[220px] break-all p-2 text-left font-mono text-xs font-normal"
                  >
                    {record.id}
                  </th>
                  <td className="whitespace-nowrap p-2">
                    {new Date(record.occurredAt).toLocaleString("zh-HK", {
                      timeZone: "Asia/Hong_Kong",
                    })}
                  </td>
                  <td className="p-2">{record.quality}</td>
                  <td className="max-w-[180px] break-all p-2 text-xs">
                    {record.staffId ?? "未指派"}
                  </td>
                  {canCorrect || canQualify ? (
                    <td className="p-2">
                      {canCorrect && (record.kind === "inquiry" || record.eventKey) ? (
                        <details>
                          <summary
                            className="cursor-pointer"
                            onClick={() => {
                              setEditingId(record.id);
                              setQuality(record.quality as typeof quality);
                              setReason("");
                              setQualificationEvidence("");
                            }}
                          >
                            修正品質
                          </summary>
                          <form
                            onSubmit={(event) => void save(event, record)}
                            className="mt-2 space-y-2"
                          >
                            <Label htmlFor={"quality-" + record.id}>品質狀態</Label>
                            <select
                              id={"quality-" + record.id}
                              className="h-9 w-full rounded border bg-background px-2"
                              value={quality}
                              onChange={(e) => setQuality(e.target.value as typeof quality)}
                            >
                              <option value="production">恢復有效</option>
                              <option value="test">標為測試</option>
                              <option value="spam">標為垃圾</option>
                              <option value="unknown">保留未知</option>
                            </select>
                            <Label htmlFor={"reason-" + record.id}>修正原因</Label>
                            <Input
                              id={"reason-" + record.id}
                              value={reason}
                              minLength={8}
                              required
                              onChange={(e) => setReason(e.target.value)}
                              placeholder="記錄核實依據"
                            />
                            <Button
                              type="submit"
                              size="sm"
                              disabled={saving === record.id || editingId !== record.id}
                            >
                              儲存修正
                            </Button>
                          </form>
                        </details>
                      ) : canCorrect && record.kind === "deal" && !record.eventKey ? (
                        <span className="text-muted-foreground">缺少來源事件，需先核對證據</span>
                      ) : null}
                      {canQualify && record.leadId && record.kind === "inquiry" ? (
                        <details className="mt-2">
                          <summary
                            className="cursor-pointer"
                            onClick={() => {
                              setEditingId(record.id);
                              setQualificationEvidence("");
                            }}
                          >
                            核實合格線索
                          </summary>
                          <form
                            onSubmit={(event) => void qualify(event, record)}
                            className="mt-2 space-y-2"
                          >
                            <Label htmlFor={"qualification-" + record.id}>核實依據</Label>
                            <Input
                              id={"qualification-" + record.id}
                              value={qualificationEvidence}
                              minLength={8}
                              required
                              onChange={(event) => setQualificationEvidence(event.target.value)}
                              placeholder="記錄實際聯絡與需求證據"
                            />
                            <Button
                              type="submit"
                              size="sm"
                              disabled={saving === record.id || editingId !== record.id}
                            >
                              記錄合格線索
                            </Button>
                          </form>
                        </details>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {page?.nextCursor ? (
        <Button type="button" variant="outline" disabled={loading} onClick={onMore}>
          載入更多
        </Button>
      ) : null}
    </section>
  );
}
