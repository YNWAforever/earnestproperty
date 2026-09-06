import { Button } from "@/components/ui/button";

export function WhatsappAiSuggestions({
  summary,
  suggestedReply,
  intentLabel,
  urgencyLabel,
  handoffNote,
  loading,
  onUseSuggestedReply,
}: {
  summary?: string;
  suggestedReply?: string | null;
  intentLabel?: string;
  urgencyLabel?: string;
  handoffNote?: string | null;
  loading: boolean;
  onUseSuggestedReply: (value: string) => void;
}) {
  return (
    <details className="rounded-md border bg-muted/20 px-3">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-sm font-medium">
        查看 AI 建議
        <span className="text-xs font-normal text-muted-foreground">
          {loading ? "產生中…" : summary ? "可供參考" : "暫未有建議"}
        </span>
      </summary>
      <div className="space-y-3 border-t py-3">
        <p className="text-xs text-muted-foreground">
          AI 內容只供參考，核對後才傳送；套用只會修改回覆草稿。
        </p>
        {summary ? (
          <>
            <p className="text-sm">{summary}</p>
            <p className="text-xs text-muted-foreground">
              AI 判斷意向：{intentLabel ?? "待確認"} · 緊急程度：{urgencyLabel ?? "待確認"}
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
                  onClick={() => onUseSuggestedReply(suggestedReply)}
                >
                  套用至回覆草稿
                </Button>
              </>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {loading ? "正在產生 AI 建議…" : "此對話暫未有建議，可直接撰寫回覆。"}
          </p>
        )}
      </div>
    </details>
  );
}
