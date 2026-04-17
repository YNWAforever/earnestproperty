import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { PropertyForm } from "@/components/dashboard/PropertyForm";

export const Route = createFileRoute("/dashboard/property/new")({
  head: () => ({
    meta: [
      { title: "新增放盤｜晉誠地產" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NewPropertyPage,
});

function NewPropertyPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth/login" });
  }, [loading, user, navigate]);

  if (loading || !user) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Button asChild variant="ghost" size="sm" className="mb-4">
        <Link to="/dashboard">
          <ArrowLeft className="mr-1 h-4 w-4" />
          返回
        </Link>
      </Button>
      <h1 className="mb-6 text-2xl font-bold">新增放盤</h1>
      <PropertyForm
        agentId={user.id}
        onSaved={() => navigate({ to: "/dashboard" })}
      />
    </div>
  );
}
