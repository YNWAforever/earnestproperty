import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PropertyForm } from "@/components/dashboard/PropertyForm";
import { useNeonAuth } from "@/hooks/use-neon-auth";

export const Route = createFileRoute("/dashboard/property/new")({
  head: () => ({
    meta: [{ title: "新增放盤｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: NewPropertyPage,
});

function NewPropertyPage() {
  const { user, loading } = useNeonAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <h1 className="text-2xl font-semibold">請先登入</h1>
        <Button asChild className="mt-5">
          <Link to="/auth/$pathname" params={{ pathname: "sign-in" }}>
            登入
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Button asChild variant="ghost" size="sm" className="mb-4">
        <Link to="/admin/listings">
          <ArrowLeft className="mr-1 h-4 w-4" />
          返回
        </Link>
      </Button>
      <h1 className="mb-6 text-2xl font-bold">新增放盤</h1>
      <PropertyForm onSaved={() => navigate({ to: "/admin/listings" })} />
    </div>
  );
}
