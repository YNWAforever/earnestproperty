import { EnquiryResolutionPanel } from "./EnquiryResolutionPanel";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useEffect, useState } from "react";
import { fetchWhatsappEnquiryDetail } from "@/lib/neon/enquiry-resolution";

/** Query-only view never reads the provider's whole-thread history. */
export function EnquiryOnlyPanel({ inquiryId }: { inquiryId: string }) {
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof fetchWhatsappEnquiryDetail>
  > | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(false);
    fetchWhatsappEnquiryDetail(inquiryId)
      .then((value) => {
        if (!cancelled) setResult(value);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [inquiryId, retry]);
  if (error)
    return (
      <div role="alert" className="space-y-2 p-4 text-sm">
        <p>未能讀取此查詢，或你沒有權限。</p>
        <button type="button" className="underline" onClick={() => setRetry((n) => n + 1)}>
          重新載入
        </button>
      </div>
    );
  if (!result)
    return (
      <p className="p-4 text-sm" role="status">
        正在載入查詢…
      </p>
    );
  return (
    <section className="space-y-3 p-4" aria-label="查詢專用視圖">
      <h2 className="font-semibold">查詢專用視圖</h2>
      <p className="text-sm text-muted-foreground">
        你只可查看與本次查詢相關的客戶來訊。其他樓盤的對話紀錄不會顯示；如需回覆，請由目前供應商確認的對話負責同事協調。
      </p>
      {result.access.canCorrect ? (
        <button type="button" className="underline" onClick={() => setReviewOpen(true)}>
          查看及修正本次查詢
        </button>
      ) : null}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogTitle>本次查詢例外修正</DialogTitle>
          <DialogDescription>
            只查看及修改本次查詢；儲存不會發送訊息或轉移整段對話。
          </DialogDescription>
          {reviewOpen ? (
            <EnquiryResolutionPanel inquiryId={inquiryId} onClose={() => setReviewOpen(false)} />
          ) : null}
        </DialogContent>
      </Dialog>
      {result.messages.length ? (
        <ul className="space-y-2">
          {result.messages.map((message) => (
            <li key={message.id} className="rounded border p-3 text-sm">
              <time className="block text-xs text-muted-foreground">{message.createdAt}</time>
              <p className="whitespace-pre-wrap break-words">{message.text ?? "（非文字訊息）"}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">尚未有可讀的本次查詢訊息。</p>
      )}
    </section>
  );
}
