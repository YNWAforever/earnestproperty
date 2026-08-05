import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ExternalLink, Pencil, Plus } from "lucide-react";

import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { AdminToolbar } from "@/components/admin/AdminToolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { fetchAdminAgentProfiles } from "@/lib/neon/admin-data";
import type { AdminAgentProfileRow } from "@/lib/neon/admin-data.types";

export const Route = createFileRoute("/admin/agents")({
  head: () => ({
    meta: [{ title: "代理管理｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminAgents,
});

function AdminAgents() {
  const { user } = useNeonAuth();
  const [profiles, setProfiles] = useState<AdminAgentProfileRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchAdminAgentProfiles()
      .then((data) => {
        if (!cancelled) setProfiles(data as AdminAgentProfileRow[]);
      })
      .catch((reason) => {
        if (!cancelled) setError(errorText(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <AdminShell title="代理管理" description="管理公開代理資料、帳戶連結、聯絡方式及發布狀態。">
      <AdminToolbar
        filters={
          <p className="self-center text-sm text-muted-foreground">代理資料由管理員或經理更新。</p>
        }
        actions={
          <Button asChild size="sm" className="h-11 lg:h-9">
            <Link to="/admin/agents/new">
              <Plus className="mr-2 h-4 w-4" />
              新增代理
            </Link>
          </Button>
        }
      />
      {error ? <AdminError message={error} /> : null}
      {!profiles && !error ? <Skeleton className="h-72 w-full" /> : null}
      {profiles?.length === 0 ? (
        <AdminEmptyState
          title="未有代理資料"
          description="新增第一位代理後，即可設定公開個人頁及聯絡資料。"
          action={
            <Button asChild>
              <Link to="/admin/agents/new">新增代理</Link>
            </Button>
          }
        />
      ) : null}
      {profiles && profiles.length > 0 ? (
        <div className="overflow-x-auto border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-muted/30 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">代理</th>
                <th className="px-4 py-3 font-medium">帳戶連結</th>
                <th className="px-4 py-3 font-medium">公開狀態</th>
                <th className="px-4 py-3 font-medium">排序</th>
                <th className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <AgentRow key={profile.id} profile={profile} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </AdminShell>
  );
}

function AgentRow({ profile }: { profile: AdminAgentProfileRow }) {
  const name = profile.name_zh || profile.name_en || "未命名代理";
  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-4">
        <p className="font-medium">{name}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {profile.job_title ?? profile.branch ?? "未設定職銜或分行"}
        </p>
      </td>
      {/* The column is 帳戶連結, but it rendered profile.email -- a plain contact
          field that has nothing to do with whether the profile is attached to a
          Neon Auth user. An agent with an email and no auth_user_id therefore
          read as linked, so a staff member who could not sign in looked
          correctly configured here. */}
      <td className="px-4 py-4">
        {profile.auth_user_id ? (
          <>
            <Badge variant="secondary">已連結</Badge>
            <p className="mt-1 text-xs text-muted-foreground">{profile.email ?? "未設定電郵"}</p>
          </>
        ) : (
          <>
            <Badge variant="outline">未連結帳戶</Badge>
            <p className="mt-1 text-xs text-muted-foreground">
              {profile.email ? `${profile.email}（僅聯絡電郵）` : "未設定電郵"}
            </p>
          </>
        )}
      </td>
      <td className="px-4 py-4">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={profile.active ? "default" : "outline"}>
            {profile.active ? "啟用" : "停用"}
          </Badge>
          <Badge variant={profile.show_on_website ? "secondary" : "outline"}>
            {profile.show_on_website ? "網站顯示" : "未公開"}
          </Badge>
        </div>
      </td>
      <td className="px-4 py-4">{profile.display_order}</td>
      <td className="px-4 py-4">
        <div className="flex justify-end gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/agents/$id" params={{ id: profile.id }}>
              <Pencil className="mr-2 h-4 w-4" />
              編輯
            </Link>
          </Button>
          {profile.public_slug && profile.active && profile.show_on_website ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/agents/$slug" params={{ slug: profile.public_slug }}>
                <ExternalLink className="mr-2 h-4 w-4" />
                查看
              </Link>
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
