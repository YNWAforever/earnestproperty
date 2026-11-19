import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImageUploadQueue } from "./ImageUploadQueue";
import { fetchAdminDistrictOptions } from "@/lib/neon/admin-data";
import { nativeFieldClassName } from "@/components/ui/native-field";
import { cn } from "@/lib/utils";

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
        className={cn(nativeFieldClassName, "w-auto min-w-0")}
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
  inputId,
  disabled,
  isWorkspaceCurrent,
  onChange,
  onUploadingChange,
}: {
  label: string;
  value: string;
  ownerType: "estate" | "article";
  inputId?: string;
  disabled?: boolean;
  isWorkspaceCurrent?: () => boolean;
  onChange: (value: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <div className="min-w-0 space-y-3 rounded-lg border p-3">
      {value.trim() ? (
        <img
          src={value.trim()}
          alt={`${label}預覽`}
          className="max-h-52 max-w-full rounded bg-muted object-contain"
        />
      ) : null}
      <ImageUploadQueue
        ownerType={ownerType}
        label={label}
        defaultWide={ownerType === "estate"}
        disabled={disabled}
        isWorkspaceCurrent={isWorkspaceCurrent}
        onPendingChange={(next) => {
          setPending(next);
          onUploadingChange?.(next);
        }}
        onUploaded={([url]) => onChange(url)}
      />
      <label className="grid gap-2 text-sm font-medium">
        {label}網址
        <Input
          id={inputId}
          type="text"
          inputMode="url"
          placeholder="https://…"
          value={value}
          disabled={disabled || pending}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    </div>
  );
}
