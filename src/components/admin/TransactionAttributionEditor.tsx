import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fetchTransactionPerformance,
  saveTransactionPerformance,
  searchTransactionAttributionOptions,
} from "@/lib/neon/admin-data";
import type {
  TransactionAttributionLookup,
  TransactionAttributionOption,
  TransactionAttributionStatus,
  TransactionPerformanceInput,
} from "@/lib/neon/transaction-performance.types";
import {
  buildAttributionInput,
  emptyForm,
  fromPerformance,
  type FormState,
} from "./transaction-attribution-editor-state";

type Props = {
  transactionId: string;
  dealType: "sale" | "rent";
  publicationVerified: boolean;
  sourceVerified?: boolean;
};
export function TransactionAttributionEditor({
  transactionId,
  dealType,
  publicationVerified,
  sourceVerified = false,
}: Props) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState<Record<TransactionAttributionLookup, string>>({
    listing: "",
    lead: "",
    staff: "",
  });
  const [options, setOptions] = useState<
    Record<TransactionAttributionLookup, TransactionAttributionOption[]>
  >({ listing: [], lead: [], staff: [] });
  const [searching, setSearching] = useState<TransactionAttributionLookup | null>(null);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const current = await fetchTransactionPerformance({ data: { transactionId } });
      setLoadError(false);
      setVersion(current?.version ?? 0);
      setForm(fromPerformance(current));
    } catch (error) {
      setLoadError(true);
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [transactionId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  async function search(kind: TransactionAttributionLookup) {
    const q = query[kind].trim();
    if (!q) return;
    setSearching(kind);
    try {
      const found = await searchTransactionAttributionOptions({
        data: {
          kind,
          q,
          ...(kind === "listing" ? { dealType } : {}),
        },
      });
      setOptions((current) => ({ ...current, [kind]: found }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(null);
    }
  }
  function choose(kind: TransactionAttributionLookup, option: TransactionAttributionOption) {
    if (kind === "listing") set("publicListingNo", option.id);
    else if (kind === "lead") set("leadId", option.id);
    else if (!form.credits.some((credit) => credit.staffId === option.id)) {
      set("credits", [
        ...form.credits,
        {
          staffId: option.id,
          branchIdAtClose: option.branchId ?? null,
          shareBps: "5000",
          label: option.label,
          branchName: option.branchName,
        },
      ]);
    }
    setOptions((current) => ({ ...current, [kind]: [] }));
  }
  async function save() {
    let input: TransactionPerformanceInput;
    try {
      input = buildAttributionInput(form, { transactionId, dealType, version });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return;
    }
    setSaving(true);
    try {
      const result = await saveTransactionPerformance({ data: input });
      setVersion(result.version);
      setForm((current) => ({ ...current, reason: "" }));
      toast.success("成交歸因已儲存");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(
        /409|stale|conflict/i.test(message)
          ? "資料版本已變更，請重新載入並核對後再儲存。"
          : message,
      );
    } finally {
      setSaving(false);
    }
  }
  const lookupLabel: Record<TransactionAttributionLookup, string> = {
    listing: "公開樓編",
    lead: "關聯客戶",
    staff: "負責／合作同事",
  };
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>成交歸因</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          公開發布：{publicationVerified ? "是" : "否"}。內部核實及佣金只供有權限職員查看。
        </p>
        {loading ? <p role="status">載入歸因資料中…</p> : null}
        {loadError ? <p role="alert">未能載入歸因資料，請重新載入後再儲存。</p> : null}
        {!sourceVerified ? (
          <p className="text-sm text-amber-700">
            內部核實前，請先在上方核實成交來源；公開發布可以保持關閉。
          </p>
        ) : null}
        <div className="space-y-1">
          <label htmlFor="attribution-status" className="text-sm font-medium">
            內部核實狀態
          </label>
          <select
            id="attribution-status"
            className="w-full rounded-md border bg-background px-3 py-2"
            value={form.status}
            onChange={(event) => {
              const status = event.target.value as TransactionAttributionStatus;
              setForm((current) => ({
                ...current,
                status,
                credits:
                  status === "cancelled" || status === "verified_unattributed"
                    ? []
                    : current.credits,
              }));
            }}
            disabled={loading || saving}
          >
            <option value="draft">草稿／待核實</option>
            <option value="verified_attributed">已核實並完整歸因</option>
            <option value="verified_unattributed">已核實但未歸因</option>
            <option value="cancelled">已取消</option>
          </select>
          {form.status === "verified_unattributed" ? (
            <p className="text-xs text-muted-foreground">
              此成交只計入公司宗數，不分配予任何同事。
            </p>
          ) : null}
        </div>
        {(["listing", "lead", "staff"] as const).map((kind) => (
          <div key={kind} className="space-y-1">
            <label htmlFor={"attribution-" + kind} className="text-sm font-medium">
              {lookupLabel[kind]}
            </label>
            <div className="flex gap-2">
              <Input
                id={"attribution-" + kind}
                value={query[kind]}
                onChange={(event) =>
                  setQuery((current) => ({ ...current, [kind]: event.target.value }))
                }
                placeholder={"搜尋" + lookupLabel[kind]}
              />
              <Button
                type="button"
                variant="outline"
                disabled={searching !== null || loading}
                onClick={() => void search(kind)}
              >
                {searching === kind ? "搜尋中…" : "搜尋"}
              </Button>
            </div>
            {options[kind].length ? (
              <ul className="rounded-md border p-2">
                {options[kind].map((option) => (
                  <li key={option.id}>
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full justify-start"
                      onClick={() => choose(kind, option)}
                    >
                      {option.label}（{option.id}）
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            {kind === "listing" && form.publicListingNo ? (
              <p className="text-xs">
                已選樓編：{form.publicListingNo}（{dealType === "sale" ? "售" : "租"}）
              </p>
            ) : null}
            {kind === "lead" && form.leadId ? (
              <p className="text-xs">
                已選 lead：{form.leadId}
                <Button type="button" variant="link" onClick={() => set("leadId", "")}>
                  移除
                </Button>
              </p>
            ) : null}
          </div>
        ))}
        <div className="space-y-2">
          <p className="text-sm font-medium">同事分配（basis points；10000＝100%）</p>
          {form.credits.map((credit, index) => (
            <div key={credit.staffId} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">
                {credit.label ?? credit.staffId}
                <br />
                <span className="text-xs text-muted-foreground">
                  分行快照：{credit.branchName ?? credit.branchIdAtClose ?? "未指定"}
                </span>
              </span>
              <Input
                aria-label={credit.staffId + " 分配 basis points"}
                type="number"
                min="1"
                max="10000"
                className="w-28"
                value={credit.shareBps}
                onChange={(event) =>
                  set(
                    "credits",
                    form.credits.map((item, i) =>
                      i === index ? { ...item, shareBps: event.target.value } : item,
                    ),
                  )
                }
              />
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  set(
                    "credits",
                    form.credits.filter((_, i) => i !== index),
                  )
                }
              >
                移除
              </Button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            目前分配{" "}
            {form.credits.reduce((sum, credit) => sum + (Number(credit.shareBps) || 0), 0) / 100}%；
            只有 100% 可標為完整歸因。
          </p>
        </div>
        <div>
          <label htmlFor="attribution-confirmed" className="text-sm font-medium">
            成交確認日期
          </label>
          <Input
            id="attribution-confirmed"
            type="date"
            value={form.confirmedAt}
            onChange={(event) => set("confirmedAt", event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="attribution-receivable" className="text-sm font-medium">
            應收佣金（港元）
          </label>
          <Input
            id="attribution-receivable"
            inputMode="decimal"
            value={form.receivable}
            onChange={(event) => set("receivable", event.target.value)}
            placeholder="未知請留空；0 請輸入 0"
          />
        </div>
        <div>
          <label htmlFor="attribution-received" className="text-sm font-medium">
            已收佣金（港元）
          </label>
          <Input
            id="attribution-received"
            inputMode="decimal"
            value={form.received}
            onChange={(event) => set("received", event.target.value)}
            placeholder="未知請留空；0 請輸入 0"
          />
        </div>
        <div>
          <label htmlFor="attribution-reason" className="text-sm font-medium">
            建立／更正原因 *
          </label>
          <Input
            id="attribution-reason"
            value={form.reason}
            onChange={(event) => set("reason", event.target.value)}
            maxLength={2000}
            placeholder="記錄證據及原因"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void reload()}
            disabled={loading || saving}
          >
            重新載入
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={loading || saving || loadError}
          >
            {saving ? "儲存中…" : "儲存成交歸因"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
