import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uploadAdminMedia } from "@/lib/admin/media-upload";
import { fetchAdminDistrictOptions } from "@/lib/neon/admin-data";

export type CmsDistrictOption = { slug: string; name_zh: string };
export function CmsDistrictSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: CmsDistrictOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      地區
      <select
        required
        className="h-10 min-w-0 rounded-md border bg-background px-3"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">請選擇地區</option>
        {value && !options.some((option) => option.slug === value) ? (
          <option value={value}>{value}（現有地區）</option>
        ) : null}
        {options.map((option) => (
          <option key={option.slug} value={option.slug}>
            {option.name_zh}
          </option>
        ))}
      </select>
    </label>
  );
}
export function CmsDistrictField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [options, setOptions] = useState<CmsDistrictOption[]>([]);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    fetchAdminDistrictOptions()
      .then((data) => {
        if (active) setOptions(data as CmsDistrictOption[]);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  return (
    <div className="space-y-2">
      <CmsDistrictSelect value={value} options={options} onChange={onChange} />
      {error ? (
        <div role="alert" className="text-sm">
          未能載入地區，現有選項已保留。
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAttempt((n) => n + 1)}
          >
            重試載入地區
          </Button>
        </div>
      ) : null}
    </div>
  );
}
export function CmsImageField({
  label,
  value,
  ownerType,
  onChange,
  onUploadingChange,
}: {
  label: string;
  value: string;
  ownerType: "estate" | "article";
  onChange: (value: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Use the newest form callback after a slow upload, so concurrent text edits survive.
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const uploadingChangeRef = useRef(onUploadingChange);
  uploadingChangeRef.current = onUploadingChange;
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      uploadingChangeRef.current?.(false);
    };
  }, []);
  return (
    <div className="space-y-3 rounded-md border p-3">
      {value ? (
        <img
          src={value}
          alt={`${label}預覽`}
          className="max-h-40 max-w-full rounded object-contain"
        />
      ) : (
        <p className="text-sm text-muted-foreground">尚未選擇圖片</p>
      )}
      <label className="grid gap-2 text-sm font-medium">
        上載{label}
        <Input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          disabled={uploading}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setUploading(true);
            uploadingChangeRef.current?.(true);
            setError(null);
            try {
              const result = await uploadAdminMedia(file, ownerType);
              if (active.current) changeRef.current(result.url);
            } catch (err) {
              if (active.current)
                setError(err instanceof Error ? err.message : "上載失敗，請重新選擇檔案重試。");
            } finally {
              if (active.current) {
                setUploading(false);
                uploadingChangeRef.current?.(false);
              }
            }
          }}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        JPG、PNG、WEBP 或 AVIF，每張不超過 5MB。上載後請儲存草稿。
      </p>
      <label className="grid gap-2 text-sm font-medium">
        {label}網址（亦可直接貼上）
        <Input
          type="text"
          inputMode="url"
          value={value}
          disabled={uploading}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      {uploading ? (
        <p role="status" className="text-sm">
          圖片上載中…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error} 其他修改已保留。
        </p>
      ) : null}
    </div>
  );
}
