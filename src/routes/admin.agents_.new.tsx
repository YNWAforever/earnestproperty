import { useAgentEditorContext } from "@/components/admin/use-agent-editor-context";
import { AdminStaffWorkspace } from "@/components/admin/AdminStaffWorkspace";
import { useStaffWorkspaceCurrent } from "@/hooks/use-staff-workspace";
import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { AgentProfileForm } from "@/components/admin/AgentProfileForm";
import { AgentEditorReadError } from "@/components/admin/AgentEditorReadError";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { fetchAdminAgentEditorContext, fetchAdminBranches } from "@/lib/neon/admin-data";
import type { AdminBranchOption } from "@/lib/neon/admin-data.types";

export const Route = createFileRoute("/admin/agents_/new")({
  loader: () => fetchAdminAgentEditorContext(),
  head: () => ({
    meta: [{ title: "新增代理｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <AdminStaffWorkspace
      component={NewAdminAgent}
      title="新增代理"
      roles={["admin", "manager"]}
      contentWidth="form"
    />
  ),
  errorComponent: ({ reset }) => <AgentEditorReadError title="新增代理" reset={reset} />,
});

function NewAdminAgent({ identity }: { identity: string }) {
  const isWorkspaceCurrent = useStaffWorkspaceCurrent(identity);
  const navigate = useNavigate();
  const {
    context: editorContext,
    pending: contextPending,
    error: contextError,
    retry: retryContext,
  } = useAgentEditorContext(identity);
  // Optional branch choices remain separate from the server capability read.
  const [branches, setBranches] = useState<AdminBranchOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchAdminBranches()
      .then((data) => {
        if (!cancelled && isWorkspaceCurrent()) setBranches(data as AdminBranchOption[]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isWorkspaceCurrent]);

  return (
    <AdminShell
      title="新增代理"
      description="建立代理公開資料。"
      contentWidth="form"
      breadcrumb={
        <nav aria-label="麵包屑">
          <Link to="/admin">後台</Link>
          {" › "}
          <Link to="/admin/agents">經紀檔案</Link>
          {" › 新增"}
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
        {contextPending ? <Skeleton className="h-96 w-full" /> : null}
        {contextError ? (
          <div>
            <AdminError message="未能載入代理編輯權限，請重試。" />
            <Button
              type="button"
              variant="outline"
              disabled={contextPending}
              onClick={retryContext}
            >
              重新載入編輯權限
            </Button>
          </div>
        ) : null}
        {!contextPending && !contextError && !editorContext ? (
          <div className="border-y py-10 text-center text-sm text-muted-foreground">
            無法取得代理編輯權限。
          </div>
        ) : null}
        {!contextPending && !contextError && editorContext ? (
          <AgentProfileForm
            isWorkspaceCurrent={isWorkspaceCurrent}
            canManageIdentity={editorContext.canManageIdentity}
            branches={branches}
            onSaved={() => navigate({ to: "/admin/agents" })}
          />
        ) : null}
      </div>
    </AdminShell>
  );
}
