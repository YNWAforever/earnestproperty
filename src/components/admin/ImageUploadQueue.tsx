import { lazy, Suspense, useId, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { ImagePlus, Loader2, Pencil, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ADMIN_IMAGE_TYPES, prepareImage } from "@/lib/admin/image-editing";
import { AdminMediaUploadError, uploadAdminMedia } from "@/lib/admin/media-upload";
import { cn } from "@/lib/utils";
import type { ImageEdit } from "./ImageEditDialog";

const ImageEditDialog = lazy(() => import("./ImageEditDialog"));

type QueueEntry = {
  id: number;
  original: File;
  prepared: File;
  source: string;
  preview: string;
  edit?: ImageEdit;
  failure?: { message: string; retryable: boolean };
};

type Props = {
  ownerType: string;
  label: string;
  inputId?: string;
  multiple?: boolean;
  defaultWide?: boolean;
  disabled?: boolean;
  isWorkspaceCurrent?: () => boolean;
  onPendingChange?: (pending: boolean) => void;
  onUploaded: (urls: string[]) => void;
};

export function ImageUploadQueue({
  ownerType,
  label,
  inputId,
  multiple = false,
  defaultWide,
  disabled,
  isWorkspaceCurrent,
  onPendingChange,
  onUploaded,
}: Props) {
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);
  const operation = useRef<object | null>(null);
  const nextId = useRef(0);
  const pending = useRef(false);
  const lifetime = useRef(0);
  const refs = useRef({ onPendingChange, onUploaded, isWorkspaceCurrent });
  refs.current = { onPendingChange, onUploaded, isWorkspaceCurrent };
  const urls = useRef(new Set<string>());
  const dragDepth = useRef(0);
  const editButton = useRef<HTMLButtonElement>(null);
  const [dragging, setDragging] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [invalid, setInvalid] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [uploadedNames, setUploadedNames] = useState<string[]>([]);
  const [editing, setEditing] = useState<QueueEntry>();
  const busy = preparing || !!progress;

  useLayoutEffect(() => {
    const objectUrls = urls.current;
    const epoch = ++lifetime.current;
    return () => {
      lifetime.current = epoch + 1;
      operation.current = null;
      for (const url of objectUrls) URL.revokeObjectURL(url);
      objectUrls.clear();
      if (pending.current && (refs.current.isWorkspaceCurrent?.() ?? true)) {
        refs.current.onPendingChange?.(false);
      }
      pending.current = false;
    };
  }, []);

  function setPending(value: boolean) {
    if (pending.current === value) return;
    pending.current = value;
    refs.current.onPendingChange?.(value);
  }

  function objectUrl(blob: Blob) {
    const url = URL.createObjectURL(blob);
    urls.current.add(url);
    return url;
  }

  function release(url: string) {
    URL.revokeObjectURL(url);
    urls.current.delete(url);
  }

  function releaseEntry(entry: QueueEntry) {
    if (entry.preview !== entry.source) release(entry.preview);
    release(entry.source);
  }

  function startOperation() {
    if (
      disabled ||
      input.current?.matches(":disabled") ||
      operation.current ||
      editing ||
      refs.current.isWorkspaceCurrent?.() === false
    )
      return;
    const epoch = lifetime.current;
    const token = {};
    operation.current = token;
    setPending(true);
    return () =>
      operation.current === token &&
      lifetime.current === epoch &&
      (refs.current.isWorkspaceCurrent?.() ?? true);
  }

  async function selectFiles(files: File[]) {
    if (!files.length || disabled || operation.current || editing) return;
    if (!multiple && files.length > 1) {
      setInvalid(["此欄位每次只可選擇一張圖片。"]);
      return;
    }
    const isCurrent = startOperation();
    if (!isCurrent) return;
    setPreparing(true);
    setInvalid([]);
    setSummary("");
    const next: QueueEntry[] = [];
    const rejected: string[] = [];
    try {
      for (const original of files) {
        if (!isCurrent()) return;
        try {
          const prepared = await prepareImage(original);
          if (!isCurrent()) return;
          const source = objectUrl(original);
          next.push({
            id: ++nextId.current,
            original,
            prepared,
            source,
            preview: prepared === original ? source : objectUrl(prepared),
          });
        } catch (error) {
          rejected.push(
            `${original.name}：${error instanceof Error ? error.message : "無法讀取圖片。"}`,
          );
        }
      }
      if (!isCurrent()) return;
      if (next.length && !multiple) for (const entry of entries) releaseEntry(entry);
      const updated = next.length && !multiple ? next : [...entries, ...next];
      setEntries(updated);
      setInvalid(rejected);
      setPending(updated.some((entry) => !entry.failure));
    } finally {
      if (isCurrent()) {
        operation.current = null;
        setPreparing(false);
      }
    }
  }

  async function upload(batch: QueueEntry[]) {
    if (!batch.length) return;
    const isCurrent = startOperation();
    if (!isCurrent) return;
    setProgress({ done: 0, total: batch.length });
    setSummary("");
    const uploaded = new Map<number, string>();
    const failed = new Map<number, QueueEntry["failure"]>();
    try {
      for (const [index, entry] of batch.entries()) {
        if (!isCurrent()) return;
        try {
          const result = await uploadAdminMedia(
            entry.edit?.file ?? entry.prepared,
            ownerType,
            isCurrent,
          );
          if (!isCurrent()) return;
          uploaded.set(entry.id, result.url);
        } catch (error) {
          if (!isCurrent()) return;
          failed.set(entry.id, {
            message: error instanceof Error ? error.message : "上載未完成，請重試。",
            retryable: !(error instanceof AdminMediaUploadError) || error.retryable,
          });
        }
        setProgress({ done: index + 1, total: batch.length });
      }
      if (!isCurrent()) return;
      const remaining = entries.flatMap((entry) => {
        if (uploaded.has(entry.id)) {
          releaseEntry(entry);
          return [];
        }
        return failed.has(entry.id) ? [{ ...entry, failure: failed.get(entry.id) }] : [entry];
      });
      setEntries(remaining);
      setSummary(
        `已上載 ${uploaded.size}／${batch.length} 張${failed.size ? `，${failed.size} 張未完成` : ""}。`,
      );
      setUploadedNames(
        batch.filter((entry) => uploaded.has(entry.id)).map((entry) => entry.original.name),
      );
      if (uploaded.size) refs.current.onUploaded([...uploaded.values()]);
      setPending(remaining.some((entry) => !entry.failure));
    } finally {
      if (isCurrent()) {
        operation.current = null;
        setProgress(undefined);
      }
    }
  }

  function remove(entry: QueueEntry) {
    releaseEntry(entry);
    const remaining = entries.filter((item) => item.id !== entry.id);
    setEntries(remaining);
    setPending(remaining.some((item) => !item.failure));
  }

  function closeEditor() {
    setEditing(undefined);
    requestAnimationFrame(() => editButton.current?.focus());
  }

  function applyEdit(entry: QueueEntry, edit?: ImageEdit) {
    if (refs.current.isWorkspaceCurrent?.() === false) return;
    if (entry.preview !== entry.source) release(entry.preview);
    const file = edit?.file ?? entry.prepared;
    const preview = file === entry.original ? entry.source : objectUrl(file);
    setEntries((current) =>
      current.map((item) => (item.id === entry.id ? { ...item, edit, preview } : item)),
    );
    closeEditor();
  }

  function acceptDrop(event: DragEvent) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = disabled || busy ? "none" : "copy";
  }

  const ready = entries.filter((entry) => !entry.failure);
  return (
    <div className="min-w-0 space-y-3">
      <div
        className={cn(
          "rounded-lg border-2 border-dashed p-4 text-center transition-colors",
          dragging && !disabled && !busy ? "border-primary bg-primary/10" : "bg-muted/30",
        )}
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          acceptDrop(event);
          dragDepth.current++;
          setDragging(true);
        }}
        onDragOver={acceptDrop}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        }}
        onDrop={(event) => {
          const files = Array.from(event.dataTransfer.files);
          if (!event.dataTransfer.types.includes("Files") && !files.length) return;
          event.preventDefault();
          event.stopPropagation();
          dragDepth.current = 0;
          setDragging(false);
          void selectFiles(files);
        }}
      >
        <ImagePlus aria-hidden="true" className="mx-auto mb-2 size-6 text-muted-foreground" />
        <p className="text-sm font-medium">
          {multiple ? "拖放一張或多張圖片到這裡" : "拖放圖片到這裡"}
        </p>
        <p id={`${uid}-formats`} className="mt-1 text-xs text-muted-foreground">
          JPG、PNG、WebP、AVIF · 每張最多 5 MB
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
          aria-label={`選擇${label}`}
          aria-describedby={`${uid}-formats`}
        >
          選擇檔案
        </Button>
        <input
          ref={input}
          id={inputId ?? uid}
          type="file"
          hidden
          aria-label={`上載${label}`}
          accept={ADMIN_IMAGE_TYPES.join(",")}
          multiple={multiple}
          disabled={disabled || busy}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            void selectFiles(files);
          }}
        />
      </div>
      {invalid.length > 0 ? (
        <ul
          role="alert"
          className="list-inside list-disc break-words rounded-md border border-destructive/30 p-3 text-sm text-destructive"
        >
          {invalid.map((error, index) => (
            <li key={`${index}-${error}`}>{error}</li>
          ))}
        </ul>
      ) : null}
      {entries.length > 0 ? (
        <ul
          aria-label="待上載圖片"
          className={cn("grid gap-2", multiple && "sm:grid-cols-2 xl:grid-cols-3")}
        >
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex min-w-0 flex-col gap-2 rounded-lg border bg-background p-2"
            >
              <div className="flex min-w-0 items-center gap-3">
                <img
                  src={entry.preview}
                  alt=""
                  className="size-14 shrink-0 rounded bg-muted object-contain"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={entry.original.name}>
                    {entry.original.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {entry.edit?.cutout
                      ? "已去背"
                      : entry.edit
                        ? "已裁剪"
                        : entry.prepared !== entry.original
                          ? "已縮小檔案"
                          : "待上載"}
                  </p>
                </div>
              </div>
              {entry.failure ? (
                <p role="alert" className="break-words text-sm text-destructive">
                  {entry.failure.message}
                  {multiple ? "" : " 其他修改已保留。"}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-1">
                {entry.failure?.retryable ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disabled || busy}
                    onClick={() => void upload([entry])}
                    aria-label={`重試 ${entry.original.name}`}
                  >
                    重試
                  </Button>
                ) : null}
                {!entry.failure ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disabled || busy}
                    aria-label={`編輯 ${entry.original.name}`}
                    onClick={(event) => {
                      editButton.current = event.currentTarget;
                      setEditing(entry);
                    }}
                  >
                    <Pencil aria-hidden="true" className="size-4" /> 編輯
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={disabled || busy}
                  onClick={() => remove(entry)}
                  aria-label={`移除待上載圖片 ${entry.original.name}`}
                >
                  <X aria-hidden="true" className="size-4" /> 移除
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {ready.length > 0 ? (
        <Button type="button" disabled={disabled || busy} onClick={() => void upload(ready)}>
          <Upload aria-hidden="true" className="size-4" />{" "}
          {multiple ? `上載 ${ready.length} 張` : `上載${label}`}
        </Button>
      ) : null}
      {preparing || progress || summary ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
          {preparing
            ? "正在準備圖片…"
            : progress
              ? `上載中 ${progress.done}／${progress.total} 張`
              : summary}
        </p>
      ) : null}
      {multiple && !busy && summary && uploadedNames.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">查看已上載檔案</summary>
          <ul className="mt-1 list-inside list-disc break-all">
            {uploadedNames.map((name, index) => (
              <li key={`${index}-${name}`}>{name}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {editing ? (
        <Suspense
          fallback={
            <p role="status" className="text-sm">
              正在開啟圖片編輯器…
            </p>
          }
        >
          <ImageEditDialog
            key={editing.id}
            original={editing.original}
            source={editing.source}
            initialEdit={editing.edit}
            defaultWide={defaultWide}
            onApply={(edit) => applyEdit(editing, edit)}
            onClose={closeEditor}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
