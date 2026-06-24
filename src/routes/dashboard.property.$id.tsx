import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PropertyForm } from "@/components/dashboard/PropertyForm";
import { fetchAdminProperty } from "@/lib/neon/admin-data";
import type { AdminPropertyInput } from "@/lib/neon/admin-data.types";
import { useNeonAuth } from "@/hooks/use-neon-auth";

type EditableProperty = Partial<AdminPropertyInput> & { id: string };

export const Route = createFileRoute("/dashboard/property/$id")({
  head: () => ({
    meta: [{ title: "編輯放盤｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: EditPropertyPage,
});

function EditPropertyPage() {
  const { id } = Route.useParams();
  const { user, loading } = useNeonAuth();
  const navigate = useNavigate();
  const [property, setProperty] = useState<EditableProperty | null>(null);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!user) {
      if (!loading) setFetching(false);
      return;
    }
    fetchAdminProperty({ data: { id } })
      .then((data) => setProperty(data as EditableProperty | null))
      .catch((err) => toast.error(err instanceof Error ? err.message : String(err)))
      .finally(() => setFetching(false));
  }, [id, loading, user]);

  if (loading || fetching) {
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

  if (!property) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12 text-center">
        <p className="text-muted-foreground">找不到放盤或無權限編輯。</p>
        <Button asChild variant="link">
          <Link to="/admin/listings">返回放盤</Link>
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
      <h1 className="mb-6 text-2xl font-bold">編輯放盤</h1>
      <div className="mb-6 rounded-lg border bg-muted/30 p-4">
        <Button asChild variant="secondary">
          <Link to="/admin/listings/$id" params={{ id }}>
            前往新版後台編輯放盤
          </Link>
        </Button>
      </div>
      <PropertyForm property={property} onSaved={() => navigate({ to: "/admin/listings" })} />
    </div>
  );
}
