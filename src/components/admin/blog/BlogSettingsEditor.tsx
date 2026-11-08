import { getBlogAdminState } from "@/lib/neon/blog-admin";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useDirtyCloseGuard, useRouteLeaveGuard } from "@/hooks/use-unsaved-changes-guard";
import type { BlogSettings } from "@/lib/blog/types";
import { CopyFields } from "./blog-fields";
import { FeaturedArticlesEditor } from "./FeaturedArticlesEditor";
import { articleError } from "./blog-editor-state";
export function BlogSettingsEditor({
  settings,
  onSave,
  onClose,
  onDirtyChange,
}: {
  settings: BlogSettings;
  onSave: (s: BlogSettings) => Promise<BlogSettings>;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [value, setValue] = useState(settings),
    [saved, setSaved] = useState(settings),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  useEffect(() => {
    onDirtyChange(dirty || busy);
    return () => onDirtyChange(false);
  }, [dirty, busy, onDirtyChange]);
  const leave = useRouteLeaveGuard(dirty || busy);
  const close = useDirtyCloseGuard({ isDirty: dirty, onClose });
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const result = await onSave(value);
          setValue(result);
          setSaved(result);
        } catch (err) {
          setError(articleError(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="grid min-w-0 gap-4">
        <CopyFields
          value={value}
          headingRequired={value.scope.kind === "main"}
          onChange={(copy) => setValue({ ...value, ...copy })}
        />
        <FeaturedArticlesEditor
          scope={value.scope}
          value={value.featuredIds}
          onChange={(featuredIds) => setValue({ ...value, featuredIds })}
        />
        <p role="status">{dirty ? "有未儲存修改" : "目前內容已儲存"}</p>
        {error ? (
          <div role="alert">
            {error}
            <details>
              <summary>目前修改備份</summary>
              <textarea
                aria-label="目前修改備份"
                className="w-full"
                readOnly
                value={JSON.stringify(value, null, 2)}
              />
            </details>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                if (!window.confirm("重新載入會放棄未儲存修改；請先複製備份。")) return;
                setBusy(true);
                try {
                  const data = await getBlogAdminState();
                  const fresh = data.settings.find(
                    (s) => JSON.stringify(s.scope) === JSON.stringify(value.scope),
                  );
                  if (!fresh) throw Error("missing");
                  setValue(fresh);
                  setSaved(fresh);
                  setError("");
                } catch (err) {
                  setError(articleError(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              重新載入網誌設定
            </Button>
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit">儲存網誌設定</Button>
          <Button type="button" variant="outline" onClick={close.requestClose}>
            返回
          </Button>
        </div>
      </fieldset>
      {leave.dialog}
      {close.dialog}
    </form>
  );
}
