import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { AgentProfileForm } from "@/components/admin/AgentProfileForm";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import {
  fetchAdminAgentEditorContext,
  fetchAdminAgentProfile,
  fetchAdminAgents,
  fetchStaffAccessSummary,
} from "@/lib/neon/admin-data";
import type {
  AdminAgentProfileRow,
  AdminAgentRow,
  StaffAccessSummary,
} from "@/lib/neon/admin-data.types";

export const Route = createFileRoute("/admin/agents_/$id")({
  loader: () => fetchAdminAgentEditorContext(),
  head: () => ({
    meta: [{ title: "編輯代理｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: EditAdminAgent,
});

function EditAdminAgent() {
  const { id } = Route.useParams();
  const editorContext = Route.useLoaderData();
  const { user, loading } = useNeonAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<AdminAgentProfileRow | null>(null);
  const [fetching, setFetching] = useState(true);
  const [access, setAccess] = useState<StaffAccessSummary | null>(null);
  const [staffOptions, setStaffOptions] = useState<{ id: string; label: string }[]>([]);
  const [accessVersion, setAccessVersion] = useState(0);

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

  // Only admins may read the access summary, so a manager simply gets null and
  // the 權限 section does not render. A failure here must not break profile
  // editing, which is why it is a separate effect from the profile load.
  // editorContext can be null (loader denied access outright), so this is
  // read with optional chaining rather than assumed non-null.
  useEffect(() => {
    if (loading || !user || !editorContext?.canManageIdentity) return;
    let cancelled = false;
    Promise.all([fetchStaffAccessSummary({ data: { staffId: id } }), fetchAdminAgents()])
      .then(([summary, agents]) => {
        if (cancelled) return;
        setAccess(summary as StaffAccessSummary);
        setStaffOptions(
          (agents as AdminAgentRow[])
            .filter((agent) => agent.id !== id && agent.active)
            .map((agent) => ({
              id: agent.id,
              label: agent.name || agent.email || agent.id,
            })),
        );
      })
      .catch(() => {
        if (!cancelled) setAccess(null);
      });
    return () => {
      cancelled = true;
    };
  }, [id, loading, user, editorContext?.canManageIdentity, accessVersion]);

  return (
    <AdminShell title="編輯代理" description="更新代理公開資料、帳戶連結及發布狀態。">
      <div className="max-w-3xl">
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
            access={access}
            activeStaffOptions={staffOptions}
            onSaved={() => navigate({ to: "/admin/agents" })}
            onAccessChanged={() => setAccessVersion((version) => version + 1)}
          />
        ) : null}
      </div>
    </AdminShell>
  );
}
