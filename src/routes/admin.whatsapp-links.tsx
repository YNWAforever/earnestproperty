import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { fetchAdminAgents } from "@/lib/neon/admin-data";
import { WhatsappLinkWizard } from "@/components/admin/whatsapp/WhatsappLinkWizard";
import { WhatsappLinksTable } from "@/components/admin/whatsapp/WhatsappLinksTable";
import { linkSeedKey, type LinkOfferSelection } from "@/lib/admin/whatsapp-link-selection";

export const Route = createFileRoute("/admin/whatsapp-links")({
  component: WhatsappLinks,
  head: () => ({
    meta: [
      { title: "WhatsApp 追蹤連結 | Earnest Admin" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function WhatsappLinks() {
  const { user, loading } = useNeonAuth();
  const [agents, setAgents] = useState<Awaited<ReturnType<typeof fetchAdminAgents>>>([]);
  const [seed, setSeed] = useState<LinkOfferSelection[]>([]);
  const [seedScope, setSeedScope] = useState("");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(linkSeedKey);
      if (stored) {
        const parsed = JSON.parse(stored) as { offers: LinkOfferSelection[]; scope?: string };
        if (Array.isArray(parsed.offers)) setSeed(parsed.offers);
        setSeedScope(typeof parsed.scope === "string" ? parsed.scope : "");
      }
    } catch {
      setError("之前的物業選擇未能恢復，請重新選擇。");
      sessionStorage.removeItem(linkSeedKey);
    }
  }, []);
  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    fetchAdminAgents()
      .then((result) => {
        if (!cancelled) setAgents(result);
      })
      .catch(() => {
        if (!cancelled) setError("同事資料未能載入。此頁只供管理員及經理使用。");
      });
    return () => {
      cancelled = true;
    };
  }, [loading, user]);
  return (
    <AdminShell
      title="WhatsApp 追蹤連結"
      description="為網站、28hse、YouTube 或其他投放建立公司 WhatsApp 短連結，先預覽核對，再分批提交。"
    >
      <div className="space-y-5">
        <nav aria-label="相關待辦" className="flex flex-wrap gap-x-4 gap-y-2 text-sm underline">
          <a href="/admin/listings?status=active">核對未指派代理與公開樓盤</a>
          <a href="/admin/whatsapp-settings">核對同事映射與試送狀態</a>
          <a href="/admin/listings">核對待核實物業內容</a>
        </nav>
        <p className="text-xs text-muted-foreground">
          已有手機端點僅代表路線資料；送達須另以 provider receipt 與同事收件核實。
        </p>
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
        {loading ? <p role="status">正在核實管理員權限…</p> : null}
        {!loading && user ? (
          <>
            <WhatsappLinkWizard
              key={user.id}
              actorScope={user.id}
              seed={seed}
              seedScope={seedScope}
              onSeedConsumed={() => {
                sessionStorage.removeItem(linkSeedKey);
                setSeed([]);
                setSeedScope("");
              }}
              agents={agents}
              onCreated={() => setRevision((value) => value + 1)}
            />
            <WhatsappLinksTable revision={revision} staff={agents} />
          </>
        ) : null}
      </div>
    </AdminShell>
  );
}
