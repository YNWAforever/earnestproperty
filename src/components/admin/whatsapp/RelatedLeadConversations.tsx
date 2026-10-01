import { useEffect, useState } from "react";
import { fetchRelatedLeadConversations } from "@/lib/neon/forwarded-enquiries";
export function RelatedLeadConversations({ leadId }: { leadId: string }) {
  const [links, setLinks] = useState<{ id: string }[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setLinks(null);
    setError(false);
    fetchRelatedLeadConversations(leadId)
      .then((value) => {
        if (live) setLinks(value);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [leadId, retry]);
  if (error)
    return (
      <p role="alert" className="mt-3 text-sm">
        未能核對相關對話權限。
        <button type="button" className="underline" onClick={() => setRetry((n) => n + 1)}>
          重新載入
        </button>
      </p>
    );
  if (!links?.length) return null;
  return (
    <div className="mt-3 space-y-1 text-sm" aria-label="相關對話">
      <h3 className="font-medium">相關對話</h3>
      {links.map((item) => (
        <a
          key={item.id}
          className="block underline"
          href={`/admin/whatsapp?conversation=${encodeURIComponent(item.id)}`}
        >
          查看已授權的 WhatsApp 對話
        </a>
      ))}
    </div>
  );
}
