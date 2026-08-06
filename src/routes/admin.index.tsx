import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, Building2, ContactRound, MessageCircle, Send } from "lucide-react";

import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { fetchAdminOverview } from "@/lib/neon/admin-data";

type Overview = Awaited<ReturnType<typeof fetchAdminOverview>>;

type MetricTarget = "/admin/listings" | "/admin/leads" | "/admin/whatsapp" | "/admin/blasts";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [{ title: "Admin｜Earnest Property" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminHome,
});

function AdminHome() {
  const { user } = useNeonAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    fetchAdminOverview()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [user]);

  return (
    <AdminShell title="總覽" description="CMS、CRM、WhatsApp 及群發工作台。">
      {error ? <AdminError message={error} /> : null}
      {!data && !error ? (
        // Was a single h-64 block standing in for a ~90px metric row, so the
        // cards below jumped ~170px upward the moment data arrived -- on the
        // first page every admin sees after signing in.
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-[88px] w-full" />
          ))}
        </div>
      ) : data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard icon={Building2} label="放盤" value={data.properties} to="/admin/listings" />
          {/* Each tile lands on a view filtered to the thing it counted --
              they all pointed at the same unfiltered list before, so clicking
              「跟進中 leads」 showed a different number than the tile did. */}
          <MetricCard
            icon={ContactRound}
            label="跟進中 leads"
            value={data.openLeads}
            to="/admin/leads"
            search={{ stage: "new" }}
          />
          {/* Both this and 跟進中 leads used to link to an unfiltered /admin/leads,
              and that page has no contacts view at all -- clicking a contact
              count landed on a lead list showing a different number. */}
          <MetricCard
            icon={BookOpen}
            label="聯絡人（累計）"
            value={data.contacts}
            to="/admin/leads"
          />
          <MetricCard
            icon={MessageCircle}
            label="WhatsApp 對話"
            value={data.openConversations}
            to="/admin/whatsapp"
          />
          <MetricCard
            icon={Send}
            label="進行中群發"
            value={data.activeCampaigns}
            to="/admin/blasts"
          />
        </div>
      ) : null}

      <section aria-labelledby="admin-overview-guidance" className="mt-5 grid gap-4 lg:grid-cols-3">
        <h2 id="admin-overview-guidance" className="sr-only">
          今日工作指引
        </h2>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">今日優先</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>1. 處理新查詢及 WhatsApp 對話。</p>
            <p>2. 更新放盤狀態、相片及 SEO 欄位。</p>
            <p>3. 審核任何準備群發的 WhatsApp template campaign。</p>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">關於 WhatsApp 發送</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            WhatsApp 發送需要技術同事完成設定才會啟用。未啟用前，後台仍可管理對話並草擬
            campaign，只是不會實際送出訊息。實際發送狀態請在「WhatsApp」頁頂查看。
          </CardContent>
        </Card>
      </section>
    </AdminShell>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  to,
  search,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  to: MetricTarget;
  search?: Record<string, string>;
}) {
  return (
    <Link to={to} search={search}>
      <Card className="h-full transition hover:border-primary/50 hover:shadow-sm">
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold">{value.toLocaleString()}</p>
          </div>
          <Icon className="h-5 w-5 text-primary" />
        </CardContent>
      </Card>
    </Link>
  );
}
