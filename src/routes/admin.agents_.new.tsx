import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { AgentProfileForm } from "@/components/admin/AgentProfileForm";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { fetchAdminAgentEditorContext } from "@/lib/neon/admin-data";

export const Route = createFileRoute("/admin/agents_/new")({
  loader: () => fetchAdminAgentEditorContext(),
  head: () => ({
    meta: [{ title: "新增代理｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: NewAdminAgent,
});

function NewAdminAgent() {
  const navigate = useNavigate();
  const editorContext = Route.useLoaderData();

  return (
    <AdminShell title="新增代理" description="建立代理公開資料。">
      <div className="max-w-3xl">
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
            onSaved={() => navigate({ to: "/admin/agents" })}
          />
        ) : null}
      </div>
    </AdminShell>
  );
}
