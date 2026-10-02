export type AiResultMethod = "model_validated" | "deterministic_rules" | "fallback";

export function aiResultPresentation(input: {
  method?: string | null;
  status?: string | null;
  checkedAt?: string | null;
  sourceRevision?: string | null;
  costAmount?: string | number | null;
  costCurrency?: string | null;
}) {
  const blocked = ["stale", "denied", "failed", "cancelled"].includes(input.status ?? "");
  const pending = input.status === "running" || input.status === "pending";
  const label = blocked
    ? "未能完成"
    : pending
      ? "仍在處理"
      : input.method === "model_validated"
        ? "模型建議"
        : input.method === "deterministic_rules" || input.method === "deterministic"
          ? "規則提示"
          : input.method === "fallback"
            ? "備用摘要"
            : "方法未核實";
  return {
    label,
    canApply: !blocked && !pending && input.method === "model_validated",
    blocker:
      input.status === "stale"
        ? "來源已改動，請重新分析。"
        : input.status === "denied"
          ? "目前權限不足，請重新載入。"
          : input.status === "cancelled"
            ? "已取消保存此結果。停止等待不等於停止計費。"
            : input.status === "failed"
              ? "未取得可用結果，請核對原有記錄後再試。"
              : null,
    checkedAt: input.checkedAt ?? "未提供",
    sourceRevision: input.sourceRevision ?? "未提供",
    cost:
      input.costAmount != null && input.costCurrency && Number.isFinite(Number(input.costAmount))
        ? `${input.costAmount} ${input.costCurrency}`
        : "未提供",
  };
}

/** Quote a customer's explicit near-term deadline, never infer urgency from volume. */
export function conversationDeadline(text: string) {
  const explicit =
    /(?:今日|今天|今晚|today)[^。！？\n]{0,35}(?:前|之前|內|before)|(?:\d+|一|兩|三)\s*(?:小時|hours?)\s*(?:內|以内)|within\s+\d+\s+hours?/i;
  return explicit.test(text) ? text.slice(0, 200) : null;
}
