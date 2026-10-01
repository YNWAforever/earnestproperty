import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  WithdrawalPage,
  WithdrawalPreview,
  WithdrawalApplyInput,
  WithdrawalBatch,
} from "@/lib/neon/admin-property-sync.types";
const approvalLabels: Record<string, string> = {
  REVIEW_REQUIRED: "待逐盤核實",
  NOT_APPROVED: "未獲批准，暫不下架",
};
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
  actorKey?: string;
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
  actorKey,
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
    [unknown, setUnknown] = useState<string | null>(null),
    [restoring, setRestoring] = useState(true),
    [recoveryError, setRecoveryError] = useState<string | null>(null);
  const recoveryMessage = "未能保存或讀取本頁提交紀錄，請管理員查核後再操作。";
  const blocked = Boolean(unknown) || restoring || Boolean(recoveryError);
  const preservePending = useCallback(
    (key: string | null) => {
      if (!actorKey) throw new Error("VERIFIED_ACTOR_REQUIRED");
      const storageKey = "earnest-property-withdrawal-pending:" + actorKey;
      if (key) sessionStorage.setItem(storageKey, JSON.stringify({ key, source }));
      else sessionStorage.removeItem(storageKey);
      setUnknown(key);
    },
    [actorKey, source],
  );
  useEffect(() => {
    if (!allowed) {
      setRestoring(false);
      return;
    }
    try {
      if (!actorKey) throw new Error("VERIFIED_ACTOR_REQUIRED");
      const value = sessionStorage.getItem("earnest-property-withdrawal-pending:" + actorKey);
      if (value) {
        const pending = JSON.parse(value);
        if (
          !pending ||
          typeof pending.key !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pending.key) ||
          !["28hse_agent_540", "propertyhk"].includes(pending.source)
        )
          throw new Error("INVALID_PENDING_WITHDRAWAL");
        setSource(pending.source);
        setUnknown(pending.key);
      }
    } catch {
      // Do not allow a new mutation when its previous key cannot be recovered.
      setRecoveryError(recoveryMessage);
    } finally {
      setRestoring(false);
    }
  }, [allowed, actorKey]);
  const latch = useRef(false),
    generation = useRef(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  const refresh = useCallback(
    async (cursor?: string | null) => {
      const token = ++generation.current;
      setBusy(true);
      setError(null);
      try {
        const next = await loadRef.current({ source, cursor });
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
    },
    [source],
  );
  useEffect(() => {
    const requestGeneration = generation;
    if (allowed) void refresh();
    return () => {
      requestGeneration.current++;
    };
  }, [allowed, refresh]);
  const toggle = (id: string, values: Set<string>, setter: (value: Set<string>) => void) => {
    const next = new Set(values);
    if (next.has(id)) next.delete(id);
    else if (next.size < 100) next.add(id);
    setter(next);
  };
  const previewSelected = async () => {
    if (!allowed || latch.current || blocked || !selected.size) return;
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
      !allowed ||
      latch.current ||
      blocked ||
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
      try {
        // Persist before sending, so a reload during the request remains locked.
        preservePending(key);
      } catch {
        setRecoveryError(recoveryMessage);
        return;
      }
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
      preservePending(null);
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
        try {
          preservePending(null);
          setError("預覽已過期，請重新預覽。");
          setReview(null);
        } catch {
          setError("結果待核實，請勿重複提交");
        }
      } else {
        setUnknown(key);
        setError(null);
      }
    } finally {
      setBusy(false);
      latch.current = false;
    }
  };
  const verify = async () => {
    if (!allowed || !unknown || latch.current) return;
    latch.current = true;
    setBusy(true);
    try {
      const r = await reconcile(unknown);
      if (r.status === "confirmed") {
        setResult(r);
        preservePending(null);
        setReview(null);
        setError(null);
        await refresh();
      } else setError(null);
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
            disabled={busy || Boolean(review) || blocked}
            onChange={(e) => setSource(e.target.value as typeof source)}
          >
            <option value="28hse_agent_540">28Hse</option>
            <option value="propertyhk">Property.hk 三分行</option>
          </select>
        </label>
        <Button variant="outline" disabled={busy || blocked} onClick={() => void refresh()}>
          更新撤盤候選
        </Button>
      </div>
      {recoveryError && <p role="alert">{recoveryError}</p>}
      {unknown && <p role="status">結果待核實，請勿重複提交</p>}
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
                    disabled={busy || blocked}
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
                    · <span>{approvalLabels[row.decision.approval] ?? "狀態待核實，暫不下架"}</span>
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
                  <p>核實狀態：{row.decision.approval}</p>
                </details>
              </li>
            ))}
          </ul>
          <div className="flex gap-3">
            <Button
              disabled={busy || !selected.size || blocked}
              onClick={() => void previewSelected()}
            >
              預覽所選撤盤
            </Button>
            {data.nextCursor && (
              <Button
                variant="outline"
                disabled={busy || blocked}
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
                    disabled={!row.decision.allowed || busy || blocked}
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
              disabled={busy || blocked}
              onChange={(e) => setReason(e.target.value)}
              placeholder="請記錄逐盤核實的原因（至少5字）"
            />
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy || blocked}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            我已逐盤核實，只套用已選項目。
          </label>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={busy || !chosen.size || !confirmed || reason.trim().length < 5 || blocked}
              onClick={() => void submit()}
            >
              確認所選撤盤
            </Button>
            <Button
              variant="outline"
              disabled={busy || blocked}
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
