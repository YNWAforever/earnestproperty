import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { AdminEstateEditorForm } from "@/components/admin/estates/AdminEstateEditorForm";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { fetchAdminCms } from "@/lib/neon/admin-data";
import type { AdminCmsData } from "@/lib/neon/admin-data.types";
import { fetchAdminCmsEditor } from "@/lib/neon/admin-cms";
import type { CmsPayloadValue } from "@/lib/neon/admin-cms.types";

export const Route = createFileRoute("/admin/estates_/$id")({
  head: () => ({
    meta: [{ title: "編輯屋苑｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: EditAdminEstate,
});

function EditAdminEstate() {
  const { id } = Route.useParams();
  const { user, loading } = useNeonAuth();
  const [payload, setPayload] = useState<Record<string, CmsPayloadValue> | null | undefined>(
    undefined,
  );
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setFetching(false);
      return;
    }
    let cancelled = false;
    setFetching(true);
    fetchAdminCmsEditor({ data: { resourceType: "estate", resourceId: id } })
      .then(async (result) => {
        if (cancelled) return;
        if (result.payload) {
          setPayload(result.payload);
          return;
        }
        // Defensive fallback: every estate should have a revision row since
        // the 2026-07-11 backfill migration, but if one somehow doesn't yet,
        // fall back to the live table rather than showing a blank editor.
        const cms = await fetchAdminCms();
        const live = (cms as AdminCmsData).estates.find((estate) => estate.id === id);
        setPayload(live ? { ...live } : null);
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "未能載入屋苑資料");
          setPayload(null);
        }
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, loading, user]);

  return (
    <AdminShell title="編輯屋苑" description="更新屋苑資料、核實狀態及 FAQ。">
      <div className="max-w-5xl">
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link to="/admin/estates">
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回
          </Link>
        </Button>
        {loading || fetching ? <Skeleton className="h-96 w-full" /> : null}
        {!loading && !fetching && payload === null ? (
          <div className="border-y py-10 text-center">
            <p className="text-sm text-muted-foreground">找不到此屋苑資料。</p>
            <Button asChild variant="link" className="mt-3">
              <Link to="/admin/estates">返回屋苑管理</Link>
            </Button>
          </div>
        ) : null}
        {!loading && !fetching && payload !== null && payload !== undefined ? (
          <AdminEstateEditorForm resourceId={id} payload={payload} onSaved={() => undefined} />
        ) : null}
      </div>
    </AdminShell>
  );
}
