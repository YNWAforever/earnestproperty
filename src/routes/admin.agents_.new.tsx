import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { AgentProfileForm } from "@/components/admin/AgentProfileForm";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/agents_/new")({
  head: () => ({
    meta: [{ title: "新增代理｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: NewAdminAgent,
});

function NewAdminAgent() {
  const navigate = useNavigate();
  return (
    <AdminShell title="新增代理" description="建立代理公開資料及可選帳戶連結。">
      <div className="max-w-3xl">
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link to="/admin/agents">
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回
          </Link>
        </Button>
        <AgentProfileForm onSaved={() => navigate({ to: "/admin/agents" })} />
      </div>
    </AdminShell>
  );
}
