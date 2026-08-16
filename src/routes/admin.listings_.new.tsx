import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { AdminShell } from "@/components/admin/AdminShell";
import { PropertyForm } from "@/components/dashboard/PropertyForm";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/listings_/new")({
  head: () => ({
    meta: [{ title: "新增放盤｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: NewAdminListingPage,
});

function NewAdminListingPage() {
  const navigate = useNavigate();

  return (
    <AdminShell
      title="新增放盤"
      description="建立售盤或租盤，設定相片、代理、SEO 及發布狀態。"
      breadcrumb={
        <nav aria-label="麵包屑">
          <Link to="/admin" className="hover:underline">
            後台
          </Link>
          {" › "}
          <Link to="/admin/listings" className="hover:underline">
            放盤
          </Link>
          {" › 新增"}
        </nav>
      }
    >
      <div className="max-w-3xl">
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link to="/admin/listings">
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回
          </Link>
        </Button>
        <PropertyForm onSaved={() => navigate({ to: "/admin/listings" })} />
      </div>
    </AdminShell>
  );
}
