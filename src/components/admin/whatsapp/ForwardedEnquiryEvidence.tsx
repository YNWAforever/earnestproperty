import { useEffect, useState } from "react";
import { fetchForwardedEnquiry } from "@/lib/neon/forwarded-enquiries";

export function ForwardedEnquiryEvidence({ leadId }: { leadId: string }) {
  const [record, setRecord] = useState<Awaited<ReturnType<typeof fetchForwardedEnquiry>> | null>(
    null,
  );
  const [error, setError] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let live = true;
    setRecord(null);
    setError(false);
    fetchForwardedEnquiry(leadId)
      .then((value) => {
        if (live) {
          setRecord(value);
          setError(!value);
        }
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [leadId, generation]);
  return (
    <section className="mt-4 space-y-2 rounded border p-3 text-sm" aria-label="人工轉交來源">
      <h3 className="font-medium">人工轉交來源</h3>
      {error ? (
        <div role="alert">
          未能讀取轉交原文或你沒有權限。
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => setGeneration((n) => n + 1)}
          >
            重新載入
          </button>
        </div>
      ) : null}
      {!record && !error ? <p role="status">正在載入原始轉交紀錄…</p> : null}
      {record ? (
        <>
          <p>
            業務來源：{record.business_source} · 轉交同事：
            {record.forwarded_by_name ?? "已核實職員"}
          </p>
          <p className="whitespace-pre-wrap">{record.raw_text}</p>
          {record.original_customer_contact ? (
            <p>原客戶聯絡線索（未核實）：{record.original_customer_contact}</p>
          ) : (
            <p>尚無原客戶聯絡方式；不能直接回覆原客。</p>
          )}
          {record.original_received_at ? (
            <p>轉交者提供的原收件時間：{String(record.original_received_at)}</p>
          ) : null}
          {record.source_url ? <p>來源網址：{record.source_url}</p> : null}
          {record.note ? <p>內部備註：{record.note}</p> : null}
          <p>此查詢沒有原客戶 WhatsApp 對話接駁；轉交者的訊息時窗與同意不可沿用。</p>
        </>
      ) : null}
    </section>
  );
}
