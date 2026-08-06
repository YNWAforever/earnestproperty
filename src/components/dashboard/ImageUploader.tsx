import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowDown, ArrowUp, Loader2, Upload, X, GripVertical } from "lucide-react";

type Props = {
  ownerType?: string;
  value: string[];
  onChange: (urls: string[]) => void;
  /** Lets the calling form's label point at the hidden file input. */
  inputId?: string;
};

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/avif"];

// Thumbnail controls stay visible instead of appearing on hover: hover never
// happens on a tablet, and a keyboard user used to tab into a transparent button.
const THUMB_BUTTON_CLASS =
  // min-h/w-11: the icons are 14px inside p-1, so the previous hit area was
  // ~22px -- half the 44px the design system uses everywhere else, on controls
  // that delete a photo or change the public cover image.
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded bg-background/90 p-1 text-foreground opacity-80 transition hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30 lg:min-h-9 lg:min-w-9";

export function ImageUploader({ ownerType = "property", value, onChange, inputId }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [failures, setFailures] = useState<string[]>([]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const valid = list.filter((f) => {
      if (!ACCEPT.includes(f.type)) {
        toast.error(`不支援檔案類型：${f.name}`);
        return false;
      }
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name} 超過 5MB`);
        return false;
      }
      return true;
    });
    if (valid.length === 0) return;

    setUploading(true);
    setProgress({ done: 0, total: valid.length });
    setFailures([]);
    const uploaded: string[] = [];
    const failed: string[] = [];
    for (let i = 0; i < valid.length; i++) {
      const file = valid[i];
      const body = new FormData();
      body.set("file", file);
      body.set("ownerType", ownerType);
      try {
        const res = await fetch("/api/admin/media/upload", { method: "POST", body });
        const data = (await res.json().catch(() => null)) as {
          url?: string;
          error?: string;
        } | null;
        if (!res.ok || !data?.url) {
          failed.push(file.name);
        } else {
          uploaded.push(data.url);
        }
      } catch {
        // A dropped connection mid-batch previously threw out of handleFiles,
        // leaving `uploading` stuck true and the button disabled forever.
        failed.push(file.name);
      }
      setProgress({ done: i + 1, total: valid.length });
    }
    setUploading(false);
    setProgress(null);
    if (uploaded.length) onChange([...value, ...uploaded]);

    // Previously each failure raised its own toast and the batch still ended on
    // a green 「已上載 N 張相片」. Selecting 12 photos and having 7 fail produced 12
    // stacked toasts, at most 3 visible, the last one green -- so the listing
    // went public with 5 of 12 photos and no record of which were missing.
    setFailures(failed);
    if (failed.length) {
      toast.error(`已上載 ${uploaded.length}／${valid.length} 張，${failed.length} 張失敗`);
    } else if (uploaded.length) {
      toast.success(`已上載 ${uploaded.length} 張相片`);
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function removeAt(idx: number) {
    const next = value.filter((_, i) => i !== idx);
    onChange(next);
  }

  function reorder(from: number, to: number) {
    if (from === to) return;
    const next = [...value];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          {uploading ? `上載中 ${progress?.done ?? 0}/${progress?.total ?? 0}` : "上載相片"}
        </Button>
        {/* The only progress indicator was the label of a disabled button, which
            a screen reader never revisits. */}
        <span aria-live="polite" className="sr-only">
          {uploading && progress ? `上載中，已完成 ${progress.done} / ${progress.total} 張` : ""}
        </span>
        <Input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ACCEPT.join(",")}
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <p className="text-xs text-muted-foreground">
          JPG / PNG / WEBP / AVIF，每張 ≤ 5MB。第一張為封面，可拖曳或用上移／下移調整次序。
        </p>
      </div>

      {/* Rendered inline so the list of failed filenames survives the toast
          being dismissed or scrolled away. */}
      {failures.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <p className="font-medium">{failures.length} 張相片上載失敗，未有加入此放盤：</p>
          <ul className="mt-1 list-inside list-disc break-words">
            {failures.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => inputRef.current?.click()}
            >
              重新選擇檔案上載
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setFailures([])}>
              知道了
            </Button>
          </div>
        </div>
      )}

      {value.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {value.map((url, i) => (
            <li
              key={url}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIdx !== null) reorder(dragIdx, i);
                setDragIdx(null);
              }}
              className="group relative overflow-hidden rounded-md border bg-muted"
            >
              <div className="aspect-[4/3] w-full">
                <img
                  src={url}
                  alt={`相片 ${i + 1}`}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
              {i === 0 && (
                <span className="absolute left-1.5 top-1.5 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                  封面
                </span>
              )}
              <span className="absolute right-1.5 top-1.5 flex gap-1">
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className={`${THUMB_BUTTON_CLASS} hover:bg-destructive hover:text-destructive-foreground`}
                  aria-label={`移除相片 ${i + 1}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
              {/* Drag is mouse-only, so the order that decides the public cover
                  image also needs buttons that work by keyboard and by touch. */}
              <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1">
                <span className="cursor-grab rounded bg-background/90 p-1 text-muted-foreground">
                  <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <button
                  type="button"
                  onClick={() => reorder(i, i - 1)}
                  disabled={i === 0}
                  className={THUMB_BUTTON_CLASS}
                  aria-label={`將相片 ${i + 1} 上移`}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => reorder(i, i + 1)}
                  disabled={i === value.length - 1}
                  className={THUMB_BUTTON_CLASS}
                  aria-label={`將相片 ${i + 1} 下移`}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
