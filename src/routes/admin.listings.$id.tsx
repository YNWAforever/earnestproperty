import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin/AdminShell";
import { PropertyForm } from "@/components/dashboard/PropertyForm";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { fetchAdminProperty } from "@/lib/neon/admin-data";
import type { AdminPropertyInput } from "@/lib/neon/admin-data.types";

type EditableProperty = Partial<AdminPropertyInput> & { id: string };

export const Route = createFileRoute("/admin/listings/$id")({
  head: () => ({
    meta: [{ title: "編輯放盤｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: EditAdminListingPage,
});

function EditAdminListingPage() {
  const { id } = Route.useParams();
  const { user, loading } = useNeonAuth();
  const navigate = useNavigate();
  const [property, setProperty] = useState<EditableProperty | null>(null);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setFetching(false);
      return;
    }

    setFetching(true);
    fetchAdminProperty({ data: { id } })
      .then((data) => setProperty(data as EditableProperty | null))
      .catch((err) => toast.error(err instanceof Error ? err.message : String(err)))
      .finally(() => setFetching(false));
  }, [id, loading, user]);

  return (
    <AdminShell title="編輯放盤" description="更新放盤內容、相片、代理、SEO 及發布狀態。">
      <div className="max-w-3xl">
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link to="/admin/listings">
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回
          </Link>
        </Button>
        {loading || fetching ? <Skeleton className="h-96 w-full" /> : null}
        {!loading && !fetching && !property ? (
          <div className="rounded-lg border bg-background p-8 text-center">
            <p className="text-sm text-muted-foreground">找不到放盤或無權限編輯。</p>
            <Button asChild variant="link" className="mt-3">
              <Link to="/admin/listings">返回放盤</Link>
            </Button>
          </div>
        ) : null}
        {!loading && !fetching && property ? (
          <PropertyForm property={property} onSaved={() => navigate({ to: "/admin/listings" })} />
        ) : null}
      </div>
    </AdminShell>
  );
}
