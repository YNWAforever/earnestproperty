import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { withStaffAuthHeaders } from "@/auth";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import {
  getWhatsappTrackingLinks,
  saveWhatsappTrackingLink,
  searchWhatsappLinkOffers,
} from "@/lib/neon/whatsapp-enquiries";
import type { TrackingLink, TrackingLinkInput } from "@/lib/neon/whatsapp-enquiries.types";
import { fetchAdminAgents } from "@/lib/neon/admin-data";
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
  const [links, setLinks] = useState<TrackingLink[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [offers, setOffers] = useState<Awaited<ReturnType<typeof searchWhatsappLinkOffers>>>([]);
  const [offerId, setOfferId] = useState("");
  const [agents, setAgents] = useState<Awaited<ReturnType<typeof fetchAdminAgents>>>([]);
  const [staff, setStaff] = useState("");
  const [source, setSource] = useState<TrackingLinkInput["placementSource"]>("website");
  const [external, setExternal] = useState("");
  const [verified, setVerified] = useState(false);
  async function refresh() {
    setLinks(await getWhatsappTrackingLinks(await withStaffAuthHeaders({})));
  }
  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    Promise.all([
      withStaffAuthHeaders({}).then((headers) => getWhatsappTrackingLinks(headers)),
      fetchAdminAgents(),
    ])
      .then(([v, a]) => {
        if (!cancelled) {
          setLinks(v);
          setAgents(a);
        }
      })
      .catch(() => {
        if (!cancelled) setError("未能載入。此頁只供管理員及經理使用。");
      });
    return () => {
      cancelled = true;
    };
  }, [loading, user]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成，請重試。");
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    const o = offers.find((x) => x.propertyId === offerId);
    await saveWhatsappTrackingLink(
      await withStaffAuthHeaders({
        data: {
          placementSource: source,
          entryPointType: o ? ("sales" as const) : ("reception" as const),
          enabled: true,
          placementVerified: verified,
          propertyId: o?.propertyId ?? null,
          publicListingNo: o?.publicListingNo ?? null,
          dealType: o?.dealType ?? null,
          requestedStaffId: staff || null,
          externalListingId: source === "28hse" ? external || null : null,
          videoId: source === "youtube" ? external || null : null,
        },
      }),
    );
    await refresh();
  }
  return (
    <AdminShell
      title="WhatsApp 追蹤連結"
      description="同一物業按網站、28hse 或 YouTube 建立不同來源連結。所有連結均經公司 WhatsApp。"
    >
      <div className="space-y-4">
        <a className="underline" href="/admin/whatsapp-settings">
          同事及 Inbox 映射設定
        </a>
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () =>
              setOffers(
                await searchWhatsappLinkOffers(await withStaffAuthHeaders({ data: { q } })),
              ),
            );
          }}
        >
          <Input
            aria-label="搜尋公開樓盤"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="樓編或物業名稱"
          />
          <Button disabled={busy}>搜尋</Button>
        </form>
        <label className="block">
          物業及交易
          <select
            className="ml-2 rounded border p-2"
            value={offerId}
            onChange={(e) => setOfferId(e.target.value)}
          >
            <option value="">公司一般查詢</option>
            {offers.map((o) => (
              <option key={o.propertyId} value={o.propertyId}>
                {o.publicListingNo} · {o.title} · {o.dealType === "sale" ? "售" : "租"}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          刊登來源
          <select
            className="ml-2 rounded border p-2"
            value={source}
            onChange={(e) => setSource(e.target.value as TrackingLinkInput["placementSource"])}
          >
            {["website", "28hse", "youtube", "other"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label className="block">
          指定同事
          <select
            className="ml-2 rounded border p-2"
            value={staff}
            onChange={(e) => setStaff(e.target.value)}
          >
            <option value="">總台／按已核實規則處理</option>
            {agents
              .filter((a) => a.active)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ?? a.id}
                </option>
              ))}
          </select>
        </label>
        {source === "28hse" || source === "youtube" ? (
          <label className="block">
            {source === "28hse" ? "28hse 廣告 ID（不是公司樓編）" : "YouTube 影片 ID"}
            <Input value={external} onChange={(e) => setExternal(e.target.value)} />
          </label>
        ) : null}
        <label className="block">
          <input
            type="checkbox"
            checked={verified}
            onChange={(e) => setVerified(e.target.checked)}
          />{" "}
          已人工核對刊登位置
        </label>
        <Button disabled={busy} onClick={() => void run(create)}>
          建立來源連結
        </Button>
        <p className="text-sm text-muted-foreground">
          建立連結不會自動刊登到外部平台。YouTube 建議文案：歡迎透過以下公司連結查詢本片物業。
        </p>
        {links.map((link) => (
          <article className="flex flex-wrap items-center gap-3 rounded border p-3" key={link.id}>
            <span>
              {link.publicListingNo ?? "一般查詢"} · {link.dealType ?? "—"} · {link.placementSource}{" "}
              · v{link.version} · {link.enabled ? "可用" : "已停用"}
            </span>
            <code className="break-all">/w/{link.code}</code>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await navigator.clipboard.writeText(`${window.location.origin}/w/${link.code}`);
                })
              }
            >
              複製
            </Button>
            <Button
              variant="outline"
              disabled={busy || !link.enabled}
              onClick={() =>
                void run(async () => {
                  const {
                    id,
                    code: _code,
                    version,
                    channelId: _channel,
                    createdAt: _created,
                    placementVerifiedAt: _verifiedAt,
                    ...input
                  } = link;
                  await saveWhatsappTrackingLink(
                    await withStaffAuthHeaders({
                      data: { ...input, id, expectedVersion: version, enabled: false },
                    }),
                  );
                  await refresh();
                })
              }
            >
              停用（新版本）
            </Button>
          </article>
        ))}
      </div>
    </AdminShell>
  );
}
