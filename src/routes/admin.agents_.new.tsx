import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { AgentProfileForm } from "@/components/admin/AgentProfileForm";
import { AgentEditorReadError } from "@/components/admin/AgentEditorReadError";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { fetchAdminAgentEditorContext, fetchAdminBranches } from "@/lib/neon/admin-data";
import type { AdminBranchOption } from "@/lib/neon/admin-data.types";

export const Route = createFileRoute("/admin/agents_/new")({
  loader: () => fetchAdminAgentEditorContext(),
  head: () => ({
    meta: [{ title: "新增代理｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: NewAdminAgent,
  errorComponent: ({ reset }) => <AgentEditorReadError title="新增代理" reset={reset} />,
});

function NewAdminAgent() {
  const navigate = useNavigate();
  const editorContext = Route.useLoaderData();
  // Fetched client-side, separately from the loader's editor-context call,
  // so the loader keeps obtaining editor context through exactly one call
  // (agents.contract.test.mjs asserts this) -- a failed fetch here just
  // leaves the 分行 dropdown showing only "未連結", never blocks the form.
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
        {!editorContext ? (
          <div className="border-y py-10 text-center text-sm text-muted-foreground">
            無法取得代理編輯權限。
          </div>
        ) : null}
        {editorContext ? (
          <AgentProfileForm
            canManageIdentity={editorContext.canManageIdentity}
            branches={branches}
            onSaved={() => navigate({ to: "/admin/agents" })}
          />
        ) : null}
      </div>
    </AdminShell>
  );
}
