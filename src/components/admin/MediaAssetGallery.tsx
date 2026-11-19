import { useRef, useState } from "react";
import { Copy, ExternalLink, File, ImageOff, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AdminMediaAssetRow } from "@/lib/neon/admin-data.types";

const OWNER_LABELS: Record<string, string> = {
  property: "放盤",
  estate: "屋苑",
  article: "文章",
  agent: "代理",
  cms: "媒體庫",
};

function mediaUrl(url: string) {
  return /^(https?:\/\/|\/(?![/\\]))/i.test(url) ? url : undefined;
}

function assetName(asset: AdminMediaAssetRow) {
  const pathname = asset.pathname.split("/").pop() ?? "";
  return asset.alt_text?.trim() || pathname.replace(/^[0-9a-f-]{36}-(?=.)/i, "") || "媒體檔案";
}

function formatBytes(value: number | null) {
  if (value == null) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function AssetImage({ asset, preview = false }: { asset: AdminMediaAssetRow; preview?: boolean }) {
  const [broken, setBroken] = useState(false);
  const isImage =
    asset.content_type?.startsWith("image/") ||
    (!asset.content_type && /\.(jpe?g|png|webp|avif|gif)(?:[?#]|$)/i.test(asset.url));
  const src = mediaUrl(asset.url);
  if (!isImage || !src || broken) {
    const Icon = isImage ? ImageOff : File;
    return (
      <span className="flex h-full min-h-24 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
        <Icon aria-hidden="true" className="size-6" />
        {isImage ? "無法預覽圖片" : "媒體檔案"}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={preview ? asset.alt_text?.trim() || assetName(asset) : ""}
      className={
        preview ? "mx-auto max-h-[55dvh] max-w-full object-contain" : "h-full w-full object-contain"
      }
      loading={preview ? "eager" : "lazy"}
      decoding="async"
      onError={() => setBroken(true)}
    />
  );
}

export function MediaAssetGallery({
  assets,
  canEdit,
  onEdit,
}: {
  assets: AdminMediaAssetRow[];
  canEdit: boolean;
  onEdit: (asset: AdminMediaAssetRow) => void;
}) {
  const [selected, setSelected] = useState<AdminMediaAssetRow>();
  const previewButton = useRef<HTMLButtonElement | null>(null);

  async function copy(asset: AdminMediaAssetRow) {
    const url = mediaUrl(asset.url);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(new URL(url, window.location.origin).href);
      toast.success("已複製圖片連結");
    } catch {
      toast.error("未能複製連結，請在預覽複製網址。");
    }
  }

  const selectedUrl = selected && mediaUrl(selected.url);
  return (
    <>
      <ul
        aria-label="媒體內容"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
      >
        {assets.map((asset) => {
          const name = assetName(asset);
          const size = formatBytes(asset.size_bytes);
          return (
            <li key={asset.id} className="min-w-0 overflow-hidden rounded-lg border bg-card">
              <button
                type="button"
                aria-label={`預覽 ${name}`}
                className="block aspect-[4/3] w-full overflow-hidden border-b bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                onClick={(event) => {
                  previewButton.current = event.currentTarget;
                  setSelected(asset);
                }}
              >
                <AssetImage key={asset.url} asset={asset} />
              </button>
              <div className="space-y-2 p-2.5 sm:p-3">
                <p className="truncate text-sm font-medium" title={name}>
                  {name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {OWNER_LABELS[asset.owner_type] ?? asset.owner_type}
                  {size ? ` · ${size}` : ""}
                </p>
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void copy(asset)}
                    disabled={!mediaUrl(asset.url)}
                    aria-label={`複製連結 ${name}`}
                  >
                    <Copy aria-hidden="true" className="size-4" /> 複製連結
                  </Button>
                  {canEdit ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(asset)}
                      aria-label={`編輯 ${name}`}
                    >
                      <Pencil aria-hidden="true" className="size-4" /> 編輯
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(undefined)}>
        {selected ? (
          <DialogContent
            className="max-h-[94dvh] w-[calc(100%-1rem)] max-w-3xl overflow-y-auto"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              previewButton.current?.focus();
            }}
          >
            <DialogHeader className="min-w-0 pr-8">
              <DialogTitle className="break-all">{assetName(selected)}</DialogTitle>
              <DialogDescription className="break-all">{selected.pathname}</DialogDescription>
            </DialogHeader>
            <div className="rounded-md border bg-muted/50 p-2">
              <AssetImage key={selected.url} asset={selected} preview />
            </div>
            <p className="break-all text-sm text-muted-foreground">
              {[
                selected.content_type,
                formatBytes(selected.size_bytes),
                OWNER_LABELS[selected.owner_type] ?? selected.owner_type,
                selected.owner_id,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {selectedUrl ? (
              <label className="grid gap-1 text-sm font-medium">
                圖片網址
                <input
                  readOnly
                  value={selectedUrl}
                  onFocus={(event) => event.currentTarget.select()}
                  className="w-full rounded-md border bg-background p-2 font-normal"
                />
              </label>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => void copy(selected)}
                disabled={!selectedUrl}
              >
                <Copy aria-hidden="true" className="size-4" /> 複製連結
              </Button>
              {selectedUrl ? (
                <Button asChild variant="outline">
                  <a href={selectedUrl} target="_blank" rel="noreferrer">
                    <ExternalLink aria-hidden="true" className="size-4" /> 開啟原圖
                  </a>
                </Button>
              ) : null}
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
