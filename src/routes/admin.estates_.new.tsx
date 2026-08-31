import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { AdminEstateEditorForm } from "@/components/admin/estates/AdminEstateEditorForm";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/estates_/new")({
  head: () => ({
    meta: [{ title: "新增屋苑｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: NewAdminEstate,
});

function NewAdminEstate() {
  const navigate = useNavigate();

  return (
    <AdminShell title="新增屋苑" description="填寫屋苑資料，儲存草稿後可繼續編輯及發布。">
      <div className="max-w-5xl">
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link to="/admin/estates">
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回
          </Link>
        </Button>
        <AdminEstateEditorForm
          onSaved={(id) => navigate({ to: "/admin/estates/$id", params: { id } })}
        />
      </div>
    </AdminShell>
  );
}
