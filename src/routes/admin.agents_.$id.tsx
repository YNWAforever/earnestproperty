import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { AgentProfileForm } from "@/components/admin/AgentProfileForm";
import { AgentEditorReadError } from "@/components/admin/AgentEditorReadError";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import {
  fetchAdminAgentEditorContext,
  fetchAdminAgentProfile,
  fetchAdminBranches,
} from "@/lib/neon/admin-data";
import type { AdminAgentProfileRow, AdminBranchOption } from "@/lib/neon/admin-data.types";

export const Route = createFileRoute("/admin/agents_/$id")({
  loader: () => fetchAdminAgentEditorContext(),
  head: () => ({
    meta: [{ title: "編輯代理｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: EditAdminAgent,
  errorComponent: ({ reset }) => <AgentEditorReadError title="編輯代理" reset={reset} />,
});

function EditAdminAgent() {
  const { id } = Route.useParams();
  const editorContext = Route.useLoaderData();
  const { user, loading } = useNeonAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<AdminAgentProfileRow | null>(null);
  const [fetching, setFetching] = useState(true);
  const [branches, setBranches] = useState<AdminBranchOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchAdminBranches()
      .then((data) => {
        if (!cancelled) setBranches(data as AdminBranchOption[]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setFetching(false);
      return;
    }
    let cancelled = false;
    setFetching(true);
    setProfile(null);
    fetchAdminAgentProfile({ data: { id } })
      .then((data) => {
        if (!cancelled) {
          setProfile(data as AdminAgentProfileRow | null);
        }
      })
      .catch((reason) => {
        if (!cancelled) toast.error(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, loading, user]);

  return (
    <AdminShell
      title="編輯代理"
      description="更新代理公開資料、帳戶連結及發布狀態。"
      contentWidth="form"
      breadcrumb={
        <nav aria-label="麵包屑">
          <Link to="/admin">後台</Link>
          {" › "}
          <Link to="/admin/agents">經紀檔案</Link>
          {" › 編輯"}
        </nav>
      }
    >
      <div className="w-full min-w-0">
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link to="/admin/agents">
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回
          </Link>
        </Button>
        {loading || fetching ? <Skeleton className="h-96 w-full" /> : null}
        {!loading && !fetching && (!profile || !editorContext) ? (
          <div className="border-y py-10 text-center">
            <p className="text-sm text-muted-foreground">找不到代理資料或無權限編輯。</p>
            <Button asChild variant="link" className="mt-3">
              <Link to="/admin/agents">返回代理管理</Link>
            </Button>
          </div>
        ) : null}
        {!loading && !fetching && profile && editorContext ? (
          <AgentProfileForm
            profile={profile}
            canManageIdentity={editorContext.canManageIdentity}
            branches={branches}
            onSaved={() => navigate({ to: "/admin/agents" })}
          />
        ) : null}
      </div>
    </AdminShell>
  );
}
