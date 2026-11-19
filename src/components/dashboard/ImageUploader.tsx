import { type Dispatch, type SetStateAction, useRef } from "react";
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react";
import { ImageUploadQueue } from "@/components/admin/ImageUploadQueue";

type Props = {
  ownerType?: string;
  disabled?: boolean;
  value: string[];
  onChange: Dispatch<SetStateAction<string[]>>;
  inputId?: string;
  onUploadingChange?: (uploading: boolean) => void;
  isWorkspaceCurrent?: () => boolean;
};

const THUMB_BUTTON_CLASS =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded bg-background/90 p-1 text-foreground opacity-80 transition hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30 lg:min-h-9 lg:min-w-9";

export function ImageUploader({
  ownerType = "property",
  disabled = false,
  value,
  onChange,
  inputId,
  onUploadingChange,
  isWorkspaceCurrent,
}: Props) {
  const dragged = useRef<{ index: number; url: string } | null>(null);

  function reorder(from: { index: number; url: string }, targetIndex: number) {
    if (disabled || from.index === targetIndex) return;
    onChange((current) => {
      if (current[from.index] !== from.url || !current[targetIndex]) return current;
      const next = [...current];
      next.splice(from.index, 1);
      next.splice(targetIndex, 0, from.url);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <ImageUploadQueue
        ownerType={ownerType}
        label="相片"
        inputId={inputId}
        multiple
        disabled={disabled}
        isWorkspaceCurrent={isWorkspaceCurrent}
        onPendingChange={onUploadingChange}
        onUploaded={(urls) =>
          onChange((current) => [
            ...current,
            ...new Set(urls.filter((url) => !current.includes(url))),
          ])
        }
      />
      {value.length > 0 ? (
        <>
          <p className="text-xs text-muted-foreground">
            第一張為封面。可拖曳相片或用箭嘴調整次序。
          </p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {value.map((url, index) => (
              <li
                key={`${url}-${index}`}
                draggable={!disabled}
                onDragStart={(event) => {
                  dragged.current = { index, url };
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", url);
                }}
                onDragEnd={() => {
                  dragged.current = null;
                }}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes("Files")) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "none";
                  } else if (dragged.current) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(event) => {
                  if (event.dataTransfer.types.includes("Files")) {
                    event.preventDefault();
                    return;
                  }
                  if (!dragged.current) return;
                  event.preventDefault();
                  reorder(dragged.current, index);
                  dragged.current = null;
                }}
                className="relative overflow-hidden rounded-md border bg-muted"
              >
                <img
                  src={url}
                  alt={`相片 ${index + 1}`}
                  className="aspect-[4/3] w-full object-cover"
                  draggable={false}
                  loading="lazy"
                />
                {index === 0 ? (
                  <span className="absolute left-1.5 top-1.5 rounded bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">
                    封面
                  </span>
                ) : null}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange((current) => current.filter((_, i) => i !== index))}
                  className={`${THUMB_BUTTON_CLASS} absolute right-1.5 top-1.5 hover:bg-destructive hover:text-destructive-foreground`}
                  aria-label={`移除相片 ${index + 1}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1">
                  <span className="cursor-grab rounded bg-background/90 p-1 text-muted-foreground">
                    <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <button
                    type="button"
                    onClick={() => reorder({ index, url }, index - 1)}
                    disabled={disabled || index === 0}
                    className={THUMB_BUTTON_CLASS}
                    aria-label={`將相片 ${index + 1} 上移`}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => reorder({ index, url }, index + 1)}
                    disabled={disabled || index === value.length - 1}
                    className={THUMB_BUTTON_CLASS}
                    aria-label={`將相片 ${index + 1} 下移`}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
