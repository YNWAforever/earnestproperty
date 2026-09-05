import { useState } from "react";
import { fetchAdminCmsEditor } from "@/lib/neon/admin-cms";
import type { CmsPayloadValue } from "@/lib/neon/admin-cms.types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Comparison is read-only: opening it must not rebase or replace local edits. */
export function CmsPublicationCompare({
  resourceType,
  resourceId,
  localPayload,
}: {
  resourceType: "estate" | "article";
  resourceId?: string;
  localPayload: Record<string, unknown>;
}) {
  const [comparison, setComparison] = useState<{
    local: string;
    published: Record<string, CmsPayloadValue> | null;
    version: number | null;
  } | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  if (!resourceId) return null;
  return (
    <section className="space-y-2 rounded border p-3">
      <Button
        type="button"
        variant="outline"
        disabled={loading}
        onClick={async () => {
          const local = JSON.stringify(localPayload, null, 2);
          setLoading(true);
          setError(false);
          try {
            const result = await fetchAdminCmsEditor({ data: { resourceType, resourceId } });
            setComparison({
              local,
              published: result.publishedPayload,
              version: result.editState?.currentPublishedVersion ?? null,
            });
          } catch {
            setError(true);
          } finally {
            setLoading(false);
          }
        }}
      >
        比較目前發布版本（保留本機修改）
      </Button>
      {error ? <p role="alert">未能載入發布版本。本機修改仍然保留，請重試。</p> : null}
      {comparison ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            本機修改備份（可複製）
            <Textarea readOnly rows={8} value={comparison.local} />
          </label>
          <label className="space-y-1 text-sm">
            目前發布版本 {comparison.version ?? "無"}
            <Textarea readOnly rows={8} value={JSON.stringify(comparison.published, null, 2)} />
          </label>
          <p className="text-sm sm:col-span-2">
            比較不會取代草稿或變更其基礎版本。請保留本機備份，由主管核對版本紀錄並還原所需版本後再套用修改。
          </p>
        </div>
      ) : null}
    </section>
  );
}
