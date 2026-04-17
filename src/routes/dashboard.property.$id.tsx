import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PropertyForm } from "@/components/dashboard/PropertyForm";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard/property/$id")({
  head: () => ({
    meta: [
      { title: "編輯放盤｜晉誠地產" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EditPropertyPage,
});

function EditPropertyPage() {
  const { id } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [property, setProperty] = useState<Tables<"properties"> | null>(null);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth/login" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("properties")
      .select("*")
      .eq("id", id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        setProperty(data ?? null);
        setFetching(false);
      });
  }, [id, user]);

  if (loading || !user || fetching) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!property) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12 text-center">
        <p className="text-muted-foreground">找不到放盤或無權限編輯。</p>
        <Button asChild variant="link"><Link to="/dashboard">返回工作台</Link></Button>
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
      <h1 className="mb-6 text-2xl font-bold">編輯放盤</h1>
      <PropertyForm
        property={property}
        agentId={user.id}
        onSaved={() => navigate({ to: "/dashboard" })}
      />
    </div>
  );
}
