import { Button } from "@/components/ui/button";
import { aiResultPresentation } from "@/lib/admin/ai-result-presentation";

export function WhatsappAiSuggestions({
  summary,
  suggestedReply,
  intentLabel,
  urgencyLabel,
  handoffNote,
  method,
  checkedAt,
  loading,
  error,
  onRetry,
  onUseSuggestedReply,
}: {
  summary?: string;
  suggestedReply?: string | null;
  intentLabel?: string;
  urgencyLabel?: string;
  handoffNote?: string | null;
  method?: string;
  checkedAt?: string;
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  onUseSuggestedReply: (value: string) => void;
}) {
  const result = aiResultPresentation({ method, checkedAt });
  return (
    <details className="rounded-md border bg-muted/20 px-3">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-sm font-medium">
        查看{summary ? result.label : "建議"}
        <span className="text-xs font-normal text-muted-foreground">
          {loading ? "產生中…" : error ? "載入失敗" : summary ? "可供參考" : "暫未有建議"}
        </span>
      </summary>
      <div className="space-y-3 border-t py-3">
        <p className="text-xs text-muted-foreground">
          內容只供參考，核對後才傳送；套用只會修改回覆草稿。
        </p>
        {error ? (
          <div role="alert" className="space-y-2 text-sm">
            <p>{error}</p>
            {onRetry ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={loading}
                onClick={onRetry}
              >
                重新載入建議
              </Button>
            ) : null}
          </div>
        ) : null}
        {summary && (
          <p className="text-xs text-muted-foreground">
            資料截至：{result.checkedAt} · 費用：{result.cost}
          </p>
        )}
        {summary ? (
          <>
            <p className="text-sm">{summary}</p>
            <p className="text-xs text-muted-foreground">
              待覆核意向：{intentLabel ?? "待確認"} · 緊急程度：{urgencyLabel ?? "待確認"}
            </p>
            {handoffNote && <p className="text-xs text-muted-foreground">{handoffNote}</p>}
            {suggestedReply && (
              <>
                <p className="whitespace-pre-wrap rounded border bg-background p-3 text-sm">
                  {suggestedReply}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={loading || Boolean(error)}
                  onClick={() => onUseSuggestedReply(suggestedReply)}
                >
                  套用至回覆草稿
                </Button>
              </>
            )}
          </>
        ) : error ? null : (
          <p className="text-sm text-muted-foreground">
            {loading ? "正在整理建議…" : "此對話暫未有建議，可直接撰寫回覆。"}
          </p>
        )}
      </div>
    </details>
  );
}
