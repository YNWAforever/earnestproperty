import { getBlogAdminState } from "@/lib/neon/blog-admin";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BlogCategory } from "@/lib/blog/types";
import { useDirtyCloseGuard, useRouteLeaveGuard } from "@/hooks/use-unsaved-changes-guard";
import { CopyFields, Field } from "./blog-fields";
import { articleError } from "./blog-editor-state";
import { validateCategoryKey } from "@/lib/blog/validation";
type CategoryInput = Omit<BlogCategory, "id"> & { id?: string };
const blank: CategoryInput = {
  key: "",
  name: "",
  heading: "",
  introduction: "",
  seoTitle: null,
  seoDescription: null,
  navigationOrder: 0,
  hidden: false,
  version: 0,
  settingsVersion: 0,
};
export function BlogCategoryManager({
  categories,
  onSave,
  onDirtyChange,
}: {
  categories: BlogCategory[];
  onSave: (v: CategoryInput) => Promise<BlogCategory>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1);
  const [value, setValue] = useState<CategoryInput | null>(null),
    [saved, setSaved] = useState<CategoryInput | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  useEffect(() => {
    onDirtyChange(dirty || busy);
    return () => onDirtyChange(false);
  }, [dirty, busy, onDirtyChange]);
  const leave = useRouteLeaveGuard(dirty || busy);
  const close = useDirtyCloseGuard({
    isDirty: dirty,
    onClose: () => {
      setValue(null);
      setSaved(null);
      setError("");
    },
  });
  const matches = categories.filter((c) =>
    (c.name + " " + c.key).toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  if (value)
    return (
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            validateCategoryKey(value.key);
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
        <fieldset disabled={busy} className="grid gap-3">
          <Field
            label="分類名稱"
            required
            value={value.name}
            onChange={(name) => setValue({ ...value, name })}
          />
          <Field
            label="分類網址鍵"
            required
            readOnly={!!value.id}
            value={value.key}
            onChange={(key) => setValue({ ...value, key })}
          />
          <label>
            導覽排序
            <Input
              type="number"
              value={value.navigationOrder}
              onChange={(e) => setValue({ ...value, navigationOrder: Number(e.target.value) })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={value.hidden}
              onChange={(e) => setValue({ ...value, hidden: e.target.checked })}
            />{" "}
            隱藏導覽（原有網址仍可存取）
          </label>
          <CopyFields value={value} onChange={(copy) => setValue({ ...value, ...copy })} />
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
                    const fresh = data.categories.find((c) => c.id === value.id);
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
                重新載入分類
              </Button>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit">儲存分類</Button>
            <Button type="button" variant="outline" onClick={close.requestClose}>
              返回分類
            </Button>
          </div>
        </fieldset>
        {leave.dialog}
        {close.dialog}
      </form>
    );
  return (
    <div className="grid gap-3">
      <Button
        onClick={() => {
          setValue({ ...blank });
          setSaved({ ...blank });
        }}
      >
        新增分類
      </Button>
      <label>
        搜尋分類
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </label>
      <p>
        共 {matches.length} 個分類 · 第 {page} 頁
      </p>
      <ul>
        {matches.slice((page - 1) * 20, page * 20).map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center justify-between gap-2 border-b py-3"
          >
            <span>
              {c.name} · {c.key}
              {c.hidden ? "（隱藏導覽）" : ""}
            </span>
            <Button
              variant="outline"
              onClick={() => {
                setValue(c);
                setSaved(c);
              }}
            >
              編輯分類 {c.name}
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          上一頁分類
        </Button>
        <Button disabled={page * 20 >= matches.length} onClick={() => setPage((p) => p + 1)}>
          下一頁分類
        </Button>
      </div>
    </div>
  );
}
