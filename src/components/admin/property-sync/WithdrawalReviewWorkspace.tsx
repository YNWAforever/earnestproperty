import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  WithdrawalPage,
  WithdrawalPreview,
  WithdrawalApplyInput,
  WithdrawalBatch,
} from "@/lib/neon/admin-property-sync.types";
const reasons: Record<string, string> = {
  not_active: "目前並非公開盤",
  staff_or_review_protected: "有人工覆寫或未解決 review",
  active_source_conflict: "其他現行廣告或來源仍活躍",
  fresh_complete_evidence_required: "缺少36小時內完整採集證據",
  terminal_evidence_required: "未核實售出／租出",
  propertyhk_absence_disabled: "Property.hk 缺席撤盤未啟用",
  source_present: "最新來源仍有此盤",
  failed_or_unknown_interval: "觀察期間有失敗或未知結果",
  two_full_observations_required: "需要兩次相隔至少24小時完整缺席觀察",
  explicit_terminal: "來源明示售出／租出，等待人工確認",
  confirmed_absence: "完整缺席證據已具備，等待人工確認",
  STALE_SOURCE_OR_PROPERTY: "來源或物業已改變，請重新預覽",
  STALE_PREVIEW: "預覽已過期，請重新預覽",
};
export interface WithdrawalReviewWorkspaceProps {
  roles: string[];
  load: (input: {
    source: "28hse_agent_540" | "propertyhk";
    cursor?: string | null;
  }) => Promise<WithdrawalPage>;
  preview: (input: {
    source: "28hse_agent_540" | "propertyhk";
    candidateIds: string[];
  }) => Promise<WithdrawalPreview>;
  apply: (input: WithdrawalApplyInput) => Promise<WithdrawalBatch>;
  reconcile: (key: string) => Promise<WithdrawalBatch>;
}
export function WithdrawalReviewWorkspace({
  roles,
  load,
  preview,
  apply,
  reconcile,
}: WithdrawalReviewWorkspaceProps) {
  const allowed = roles.some((r) => ["admin", "manager"].includes(r));
  const [source, setSource] = useState<"28hse_agent_540" | "propertyhk">("28hse_agent_540");
  const [data, setData] = useState<WithdrawalPage | null>(null),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [review, setReview] = useState<WithdrawalPreview | null>(null),
    [chosen, setChosen] = useState<Set<string>>(new Set()),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [result, setResult] = useState<WithdrawalBatch | null>(null),
    [unknown, setUnknown] = useState<string | null>(null);
  const latch = useRef(false),
    generation = useRef(0);
  const refresh = async (cursor?: string | null) => {
    const token = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const next = await load({ source, cursor });
      if (token === generation.current) {
        setData((old) => (cursor && old ? { ...next, rows: [...old.rows, ...next.rows] } : next));
        if (!cursor) {
          setReview(null);
          setSelected(new Set());
          setChosen(new Set());
        }
      }
    } catch {
      if (token === generation.current) setError("未能讀取撤盤候選，沒有更改樓盤。");
    } finally {
      if (token === generation.current) setBusy(false);
    }
  };
  useEffect(() => {
    if (allowed) void refresh();
    return () => {
      generation.current++;
    };
  }, [allowed, source]);
  const toggle = (id: string, values: Set<string>, setter: (value: Set<string>) => void) => {
    const next = new Set(values);
    if (next.has(id)) next.delete(id);
    else if (next.size < 100) next.add(id);
    setter(next);
  };
  const previewSelected = async () => {
    if (latch.current || !selected.size) return;
    latch.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await preview({ source, candidateIds: [...selected] });
      setReview(r);
      setChosen(
        new Set(r.rows.filter((row) => row.decision.allowed).map((row) => row.candidateId)),
      );
      setConfirmed(false);
      setReason("");
      setResult(null);
    } catch {
      setError("未能建立預覽，沒有更改樓盤。");
    } finally {
      setBusy(false);
      latch.current = false;
    }
  };
  const submit = async () => {
    if (
      latch.current ||
      !review ||
      !chosen.size ||
      !confirmed ||
      reason.trim().length < 5 ||
      unknown
    )
      return;
    latch.current = true;
    setBusy(true);
    setError(null);
    const key = crypto.randomUUID();
    try {
      const r = await apply({
        previewId: review.previewId,
        selectedIds: [...chosen],
        expectedVersions: Object.fromEntries(
          review.rows
            .filter((row) => chosen.has(row.candidateId))
            .map((row) => [row.candidateId, row.version]),
        ),
        idempotencyKey: key,
        reason,
      });
      setResult(r);
      setReview(null);
      setSelected(new Set());
      setChosen(new Set());
      try {
        const next = await load({ source });
        setData(next);
      } catch {
        setError("撤盤結果已確認，但未能重新載入候選。請更新紀錄。");
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("STALE_PREVIEW")) {
        setError("預覽已過期，請重新預覽。");
        setReview(null);
      } else {
        setUnknown(key);
        setError("結果待核實，請勿重複提交");
      }
    } finally {
      setBusy(false);
      latch.current = false;
    }
  };
  const verify = async () => {
    if (!unknown || latch.current) return;
    latch.current = true;
    setBusy(true);
    try {
      const r = await reconcile(unknown);
      if (r.status === "confirmed") {
        setResult(r);
        setUnknown(null);
        setReview(null);
        setError(null);
        await refresh();
      } else setError("結果待核實，請勿重複提交");
    } catch {
      setError("未能核對提交結果，請保留此紀錄交由管理員查核。");
    } finally {
      setBusy(false);
      latch.current = false;
    }
  };
  if (!allowed) return <p role="alert">你沒有權限批量核實全公司撤盤。</p>;
  return (
    <section aria-label="撤盤核實" className="mt-8 space-y-4 border-t pt-6">
      <h2 className="text-xl font-semibold">撤盤核實</h2>
      <p className="text-sm">
        歷史缺席只屬候選。等待核實，暫不下架。此操作保留物業、公開盤號及人工覆寫紀錄。
      </p>
      <div className="flex flex-wrap gap-3">
        <label>
          來源{" "}
          <select
            className="h-11 rounded-md border px-3"
            aria-label="撤盤來源"
            value={source}
            disabled={busy || Boolean(review) || Boolean(unknown)}
            onChange={(e) => setSource(e.target.value as typeof source)}
          >
            <option value="28hse_agent_540">28Hse</option>
            <option value="propertyhk">Property.hk 三分行</option>
          </select>
        </label>
        <Button
          variant="outline"
          disabled={busy || Boolean(unknown)}
          onClick={() => void refresh()}
        >
          更新撤盤候選
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {busy && !data && <p role="status">正在讀取候選…</p>}
      {data && !data.enabled && <p role="status">{data.reason ?? "撤盤 review 尚未啟用"}</p>}
      {data?.enabled && !review && (
        <>
          <p>已選 {selected.size} 項（上限100，只包含已載入項目）</p>
          {!data.rows.length && <p>沒有待核實撤盤候選。</p>}
          <ul className="space-y-3">
            {data.rows.map((row) => (
              <li key={row.candidateId} className="rounded-xl border p-4">
                <label className="flex gap-3">
                  <input
                    type="checkbox"
                    aria-label={"選取 " + row.title}
                    checked={selected.has(row.candidateId)}
                    disabled={busy || Boolean(unknown)}
                    onChange={() => toggle(row.candidateId, selected, setSelected)}
                  />
                  <span>
                    <strong>
                      {row.title} · {row.dealType === "sale" ? "出售" : "出租"}
                    </strong>
                    <br />
                    {row.evidence.kind === "explicit_terminal"
                      ? "明示售出／租出"
                      : "歷史未再看到"}{" "}
                    · {row.decision.approval}
                    <br />
                    {reasons[row.decision.reason] ?? row.decision.reason}
                    {row.evidence.otherActiveSources.length > 0 && (
                      <p>來源狀態有分歧：其他廣告仍活躍，須人工核實。</p>
                    )}
                  </span>
                </label>
                <details className="mt-2 text-xs break-all">
                  <summary>來源及版本</summary>
                  {row.propertyNo} · {row.version}
                </details>
              </li>
            ))}
          </ul>
          <div className="flex gap-3">
            <Button
              disabled={busy || !selected.size || Boolean(unknown)}
              onClick={() => void previewSelected()}
            >
              預覽所選撤盤
            </Button>
            {data.nextCursor && (
              <Button
                variant="outline"
                disabled={busy || Boolean(unknown)}
                onClick={() => void refresh(data.nextCursor)}
              >
                更多撤盤候選
              </Button>
            )}
          </div>
        </>
      )}
      {review && (
        <div className="rounded-xl border p-4 space-y-4">
          <h3 className="font-semibold">確認撤盤預覽</h3>
          <p>
            有效至{" "}
            {new Date(review.expiresAt).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}
            。提交時會重新核對來源及版本。
          </p>
          <ul className="space-y-3">
            {review.rows.map((row) => (
              <li key={row.candidateId}>
                <label className="flex gap-3">
                  <input
                    type="checkbox"
                    aria-label={"套用 " + row.title}
                    checked={chosen.has(row.candidateId)}
                    disabled={!row.decision.allowed || busy || Boolean(unknown)}
                    onChange={() => toggle(row.candidateId, chosen, setChosen)}
                  />
                  <span>
                    {row.title} · {row.decision.allowed ? "可核實套用" : "禁止套用"}
                    <br />
                    {reasons[row.decision.reason] ?? row.decision.reason}
                    {row.evidence.otherActiveSources.length > 0 && (
                      <p>來源狀態有分歧：其他廣告仍活躍，須人工核實。</p>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <label className="block">
            核實原因
            <Input
              aria-label="核實原因"
              value={reason}
              maxLength={1000}
              disabled={busy || Boolean(unknown)}
              onChange={(e) => setReason(e.target.value)}
              placeholder="請記錄逐盤核實的原因（至少5字）"
            />
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy || Boolean(unknown)}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            我已逐盤核實，只套用已選項目。
          </label>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={
                busy || !chosen.size || !confirmed || reason.trim().length < 5 || Boolean(unknown)
              }
              onClick={() => void submit()}
            >
              確認所選撤盤
            </Button>
            <Button
              variant="outline"
              disabled={busy || Boolean(unknown)}
              onClick={() => {
                setReview(null);
                setChosen(new Set());
              }}
            >
              取消預覽
            </Button>
          </div>
        </div>
      )}
      {unknown && (
        <Button variant="outline" disabled={busy} onClick={() => void verify()}>
          核對提交結果
        </Button>
      )}
      {result && (
        <div role="status" className="rounded-xl border p-4">
          <h3>撤盤結果</h3>
          <ul>
            {result.results.map((row) => (
              <li key={row.candidateId}>
                {row.propertyNo}：
                {row.status === "applied"
                  ? "已核實下架"
                  : (reasons[row.reason ?? ""] ?? "未套用，請重新核對及預覽")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
