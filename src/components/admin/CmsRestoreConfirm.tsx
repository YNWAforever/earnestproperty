import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { cmsFieldDiff, type CmsDiffResource } from "@/lib/admin/cms-field-diff";
import type { CmsRevisionSummary } from "@/lib/neon/admin-cms.types";
import { formatHkDateTime } from "@/lib/format";

const REVISION_STATE_LABELS: Record<CmsRevisionSummary["state"], string> = {
  draft: "草稿",
  published: "已發布",
  superseded: "已被取代",
  archived: "已封存",
};

function when(value: string) {
  return formatHkDateTime(value) ?? value;
}

/**
 * The one 還原 confirmation for every CMS editor.
 *
 * 還原 creates a new draft from the chosen version, replaces the open form with it and
 * retires the staff member's own saved draft (`cms_mutate` restore). So before anything
 * happens it says which unsaved form fields and which saved draft will be replaced.
 * Cancelling changes nothing; confirming hands the version back to the caller's existing
 * restore call.
 */
export function CmsRestoreConfirm({
  resource,
  revision,
  savedPayload,
  form,
  savedDraft,
  labels,
  isPending,
  onOpenChange,
  onConfirm,
}: {
  resource: CmsDiffResource;
  /** The version to restore; the dialog is open while this is set. */
  revision: CmsRevisionSummary | null;
  /** What the form was loaded from or last saved as. */
  savedPayload: Record<string, unknown> | null;
  /** The form as it is now. */
  form: Record<string, unknown>;
  /** The staff member's own saved draft, which restore retires. */
  savedDraft: CmsRevisionSummary | null | undefined;
  /** Labels for a form with more fields than the 內容中心 dialog. */
  labels?: Record<string, string>;
  isPending?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (revisionId: string) => void;
}) {
  if (!revision) return null;
  const { changes, otherChanged } = cmsFieldDiff(resource, savedPayload, form, labels);
  const clean = changes.length === 0 && otherChanged === 0;
  return (
    <AdminConfirmDialog
      open
      title="還原此版本？"
      description={`還原會以 v${revision.versionNumber}（${REVISION_STATE_LABELS[revision.state]}，${when(revision.createdAt)}）的內容建立新草稿。以下內容會被取代：`}
      confirmLabel="還原"
      isPending={isPending}
      onOpenChange={onOpenChange}
      onConfirm={() => onConfirm(revision.id)}
    >
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {clean ? <li>目前沒有未儲存的修改。</li> : null}
        {changes.length ? (
          <li>目前表單內未儲存的修改：{changes.map((change) => change.label).join("、")}</li>
        ) : null}
        {otherChanged ? <li>另有 {otherChanged} 項系統欄位不同。</li> : null}
        {savedDraft ? (
          <li>
            你已儲存的草稿 v{savedDraft.versionNumber}（{when(savedDraft.createdAt)}）
          </li>
        ) : null}
      </ul>
    </AdminConfirmDialog>
  );
}
