import { useEffect, useId, useRef, useState } from "react";
import { Crop, Loader2, Scissors } from "lucide-react";
import ReactCrop, { centerCrop, makeAspectCrop, type PercentCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { nativeFieldClassName } from "@/components/ui/native-field";
import { exportImage, removeImageBackground, renderImage } from "@/lib/admin/image-editing";

const RATIOS = { free: undefined, "16:9": 16 / 9, "4:3": 4 / 3, "1:1": 1 };
const FULL_IMAGE: PercentCrop = { unit: "%", x: 0, y: 0, width: 100, height: 100 };
const CROP_LABELS = {
  cropArea: "裁剪範圍（用方向鍵移動）",
  nwDragHandle: "調整左上角",
  nDragHandle: "調整上方邊緣",
  neDragHandle: "調整右上角",
  eDragHandle: "調整右側邊緣",
  seDragHandle: "調整右下角",
  sDragHandle: "調整下方邊緣",
  swDragHandle: "調整左下角",
  wDragHandle: "調整左側邊緣",
};
type Ratio = keyof typeof RATIOS;

export type ImageEdit = { file: File; crop?: PercentCrop; ratio: Ratio; cutout: boolean };

export default function ImageEditDialog({
  original,
  source,
  initialEdit,
  defaultWide,
  onApply,
  onClose,
}: {
  original: File;
  source: string;
  initialEdit?: ImageEdit;
  defaultWide?: boolean;
  onApply: (edit: ImageEdit | undefined) => void;
  onClose: () => void;
}) {
  const ratioId = useId();
  const img = useRef<HTMLImageElement>(null);
  const operation = useRef<AbortController | null>(null);
  const [ratio, setRatio] = useState<Ratio>(initialEdit?.ratio ?? (defaultWide ? "16:9" : "free"));
  const [crop, setCrop] = useState(initialEdit?.crop);
  const [result, setResult] = useState<ImageEdit | undefined>(initialEdit);
  const [showResult, setShowResult] = useState(!!initialEdit);
  const [showOriginal, setShowOriginal] = useState(false);
  const [preview, setPreview] = useState<string>();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<"crop" | "cutout" | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    if (!result) return;
    const url = URL.createObjectURL(result.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);

  function selectRatio(next: Ratio, image: HTMLImageElement) {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const aspect = RATIOS[next];
    setCrop(
      aspect
        ? centerCrop(makeAspectCrop({ unit: "%", width: 90 }, aspect, width, height), width, height)
        : (crop ?? FULL_IMAGE),
    );
  }

  async function generate(cutout: boolean) {
    const image = img.current;
    if (!image?.naturalWidth || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(cutout ? "cutout" : "crop");
    setError(undefined);
    const region = crop?.width && crop.height ? crop : undefined;
    try {
      const canvas = renderImage(image, region);
      if (cutout) await removeImageBackground(canvas, controller.signal);
      const file = await exportImage(canvas, original, cutout);
      if (controller.signal.aborted) return;
      setResult({ file, ratio, crop: region, cutout });
      setShowResult(true);
      setShowOriginal(false);
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "無法編輯這張圖片，請重試。");
      }
    } finally {
      if (!controller.signal.aborted) {
        operation.current = null;
        setBusy(null);
      }
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[94dvh] w-[calc(100%-1rem)] max-w-3xl overflow-y-auto">
        <DialogHeader className="min-w-0 pr-8">
          <DialogTitle>編輯圖片</DialogTitle>
          <DialogDescription className="break-all">{original.name}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          {showResult ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-pressed={showOriginal}
                onClick={() => setShowOriginal((current) => !current)}
              >
                {showOriginal ? "顯示編輯結果" : "比較原圖"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setShowResult(false)}
              >
                調整裁剪
              </Button>
            </>
          ) : (
            <>
              <label htmlFor={ratioId} className="text-sm font-medium">
                裁剪比例
              </label>
              <select
                id={ratioId}
                className={`${nativeFieldClassName} w-auto`}
                value={ratio}
                disabled={!ready || !!busy}
                onChange={(event) => {
                  const next = event.target.value as Ratio;
                  setRatio(next);
                  if (img.current) selectRatio(next, img.current);
                }}
              >
                <option value="free">自由裁剪</option>
                <option value="16:9">16:9</option>
                <option value="4:3">4:3</option>
                <option value="1:1">1:1</option>
              </select>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!crop || !!busy}
                onClick={() => setCrop(undefined)}
              >
                清除裁剪框
              </Button>
            </>
          )}
        </div>
        <div className="min-w-0 rounded-md border bg-muted/50 p-2 text-center">
          <div hidden={showResult}>
            <ReactCrop
              crop={crop}
              ariaLabels={CROP_LABELS}
              aspect={RATIOS[ratio]}
              onChange={(_, percent) => setCrop(percent)}
              disabled={!!busy}
              ruleOfThirds
            >
              <img
                ref={img}
                src={source}
                alt="原圖裁剪區域"
                className="max-h-[45dvh] max-w-full"
                onLoad={(event) => {
                  if (!initialEdit) selectRatio(ratio, event.currentTarget);
                  setReady(true);
                }}
                onError={() => setError("無法讀取原圖。")}
              />
            </ReactCrop>
          </div>
          {showResult && preview ? (
            <img
              src={showOriginal ? source : preview}
              alt={showOriginal ? "原圖" : result?.cutout ? "去背結果" : "裁剪結果"}
              className="mx-auto max-h-[45dvh] max-w-full bg-[repeating-conic-gradient(#e2e8f0_0%_25%,#fff_0%_50%)] bg-[length:18px_18px]"
            />
          ) : null}
        </div>
        {busy ? (
          <p role="status" className="flex items-center gap-2 text-sm">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            {busy === "cutout" ? "正在移除背景…" : "正在製作裁剪預覽…"}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter className="flex-wrap gap-2 sm:space-x-0">
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!!busy}
            onClick={() => onApply(undefined)}
          >
            使用原圖
          </Button>
          {showResult && result ? (
            <>
              {!result.cutout ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!ready || !!busy}
                  onClick={() => void generate(true)}
                >
                  <Scissors aria-hidden="true" className="size-4" /> 移除背景
                </Button>
              ) : null}
              <Button type="button" disabled={!!busy} onClick={() => onApply(result)}>
                套用編輯
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={!ready || !!busy}
                onClick={() => void generate(true)}
              >
                <Scissors aria-hidden="true" className="size-4" /> 移除背景
              </Button>
              <Button
                type="button"
                disabled={!ready || !crop?.width || !crop.height || !!busy}
                onClick={() => void generate(result?.cutout ?? false)}
              >
                <Crop aria-hidden="true" className="size-4" />{" "}
                {result?.cutout ? "更新裁剪及去背" : "預覽裁剪"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
