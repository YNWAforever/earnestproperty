import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { AdminEstateEditorForm } from "@/components/admin/estates/AdminEstateEditorForm";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { fetchAdminCmsEditor } from "@/lib/neon/admin-cms";
import type { CmsEditorResult } from "@/lib/neon/admin-cms.types";

export const Route = createFileRoute("/admin/estates_/$id")({
  head: () => ({
    meta: [{ title: "編輯屋苑｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: EditAdminEstate,
});

function EditAdminEstate() {
  const { id } = Route.useParams();
  const { user, loading } = useNeonAuth();
  const [editor, setEditor] = useState<CmsEditorResult | null>(null);
  const [fetching, setFetching] = useState(true);
  const [readError, setReadError] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setFetching(false);
      return;
    }
    let cancelled = false;
    setFetching(true);
    fetchAdminCmsEditor({ data: { resourceType: "estate", resourceId: id } })
      .then((result) => {
        if (!cancelled) {
          setEditor(result);
          setReadError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReadError(true);
          setEditor(null);
        }
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, loading, user, readAttempt]);

  return (
    <AdminShell
      title="編輯屋苑"
      description="更新屋苑資料、核實狀態及 FAQ。"
      contentWidth="form"
      breadcrumb={
        <nav aria-label="麵包屑">
          <Link to="/admin">後台</Link>
          {" › "}
          <Link to="/admin/estates">屋苑管理</Link>
          {" › 編輯"}
        </nav>
      }
    >
      <div className="w-full min-w-0">
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link to="/admin/estates">
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回
          </Link>
        </Button>
        {loading || fetching ? <Skeleton className="h-96 w-full" /> : null}
        {readError ? (
          <div className="space-y-2">
            <AdminError message="未能載入屋苑資料，並非確認資料不存在。請重試或核對存取權限。" />
            <Button
              type="button"
              variant="outline"
              disabled={fetching}
              onClick={() => setReadAttempt((value) => value + 1)}
            >
              重新載入屋苑
            </Button>
          </div>
        ) : null}
        {!loading && !fetching && !readError && !editor?.editState ? (
          <div className="border-y py-10 text-center">
            <p className="text-sm text-muted-foreground">找不到此屋苑資料。</p>
            <Button asChild variant="link" className="mt-3">
              <Link to="/admin/estates">返回屋苑管理</Link>
            </Button>
          </div>
        ) : null}
        {!loading && !fetching && editor?.editState ? (
          <AdminEstateEditorForm
            key={id}
            resourceId={id}
            payload={editor.payload}
            editState={editor.editState}
            onSaved={() => undefined}
          />
        ) : null}
      </div>
    </AdminShell>
  );
}
