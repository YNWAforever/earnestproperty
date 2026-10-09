import { useEffect, useRef, useState } from "react";
import { fetchAdminCmsEditor } from "@/lib/neon/admin-cms";
import type { CmsPayloadValue } from "@/lib/neon/admin-cms.types";
import { cmsFieldDiff, type CmsDiffResource } from "@/lib/admin/cms-field-diff";
import { copyCmsLocalBackup } from "@/lib/admin/cms-local-backup";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

/** Values longer than this, or over three lines, start clamped with a 顯示全部 toggle. */
const LONG_VALUE_CHARS = 120;

function isLong(value: string) {
  return value.length > LONG_VALUE_CHARS || value.split("\n").length > 3;
}

function CompareValue({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!isLong(value)) return <span className="whitespace-pre-wrap break-words">{value}</span>;
  return (
    <span className="block space-y-1">
      <span className={`block whitespace-pre-wrap break-words ${expanded ? "" : "line-clamp-3"}`}>
        {value}
      </span>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? "收起" : "顯示全部"}
      </Button>
    </span>
  );
}

/** The field table for one comparison, shown after 與已發布版本比較 loads. */
export function CmsCompareResult({
  resourceType,
  published,
  version,
  local,
  labels,
}: {
  resourceType: CmsDiffResource;
  published: Record<string, unknown> | null;
  version: number | null;
  local: Record<string, unknown>;
  labels?: Record<string, string>;
}) {
  const { changes, otherChanged } = cmsFieldDiff(resourceType, published, local, labels);
  return (
    <div className="space-y-2 text-sm">
      {published ? (
        <h3 className="font-semibold">與已發布版本 v{version ?? "—"} 比較</h3>
      ) : (
        <p>此內容尚未發布，以下列出目前表單的所有欄位。</p>
      )}
      {changes.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">欄位</TableHead>
              <TableHead>已發布版本</TableHead>
              <TableHead>目前表單</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {changes.map((change) => (
              <TableRow key={change.key}>
                <TableHead scope="row" className="h-auto py-2 align-top font-medium">
                  {change.label}
                </TableHead>
                <TableCell className="align-top whitespace-normal">
                  <CompareValue value={change.before} />
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  <CompareValue value={change.after} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : otherChanged === 0 ? (
        <p>目前表單與已發布版本相同。</p>
      ) : null}
      {otherChanged ? (
        <p className="text-muted-foreground">另有 {otherChanged} 項系統欄位不同。</p>
      ) : null}
    </div>
  );
}

/** Comparison is read-only: opening it must not rebase or replace local edits. */
export function CmsPublicationCompare({
  resourceType,
  resourceId,
  localPayload,
  labels,
}: {
  resourceType: CmsDiffResource;
  resourceId?: string;
  localPayload: Record<string, unknown>;
  /** Labels for a form with more fields than the 內容中心 dialog. */
  labels?: Record<string, string>;
}) {
  const [comparison, setComparison] = useState<{
    local: Record<string, unknown>;
    published: Record<string, CmsPayloadValue> | null;
    version: number | null;
  } | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  // Shown only when the clipboard refuses: the same local edits, ready to copy by hand.
  const [backup, setBackup] = useState<{ text: string } | null>(null);
  const backupRef = useRef<HTMLTextAreaElement>(null);
  // When the clipboard refuses, take staff straight to the box they now copy from by hand.
  useEffect(() => {
    if (backup !== null) backupRef.current?.focus();
  }, [backup]);
  if (!resourceId) return null;

  return (
    <section className="space-y-2 rounded border p-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={loading}
          onClick={async () => {
            const local = { ...localPayload };
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
          與已發布版本比較
        </Button>
        {/* The recovery copy a save conflict points to; it never depends on the compare load. */}
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            // A fresh object each failure, so a repeated failure moves focus again.
            const text = await copyCmsLocalBackup(localPayload);
            setBackup(text === null ? null : { text });
          }}
        >
          複製本機修改（備份）
        </Button>
      </div>
      {error ? <p role="alert">未能載入發布版本。本機修改仍然保留，請重試。</p> : null}
      {comparison ? (
        <div className="space-y-3">
          <CmsCompareResult
            resourceType={resourceType}
            published={comparison.published}
            version={comparison.version}
            local={comparison.local}
            labels={labels}
          />
          <p className="text-sm">
            比較不會取代草稿或變更其基礎版本。請保留本機備份，由主管核對版本紀錄並還原所需版本後再套用修改。
          </p>
        </div>
      ) : null}
      {backup !== null ? (
        <label className="block space-y-1 text-sm">
          本機修改備份（可複製）
          <Textarea ref={backupRef} readOnly rows={8} value={backup.text} />
        </label>
      ) : null}
    </section>
  );
}
