import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Upload, X, GripVertical } from "lucide-react";

type Props = {
  agentId: string;
  value: string[];
  onChange: (urls: string[]) => void;
};

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/avif"];

export function ImageUploader({ agentId, value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

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
    const uploaded: string[] = [];
    for (let i = 0; i < valid.length; i++) {
      const file = valid[i];
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${agentId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from("property-images")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) {
        toast.error(`上載失敗：${file.name} — ${error.message}`);
      } else {
        const { data } = supabase.storage.from("property-images").getPublicUrl(path);
        uploaded.push(data.publicUrl);
      }
      setProgress({ done: i + 1, total: valid.length });
    }
    setUploading(false);
    setProgress(null);
    if (uploaded.length) {
      onChange([...value, ...uploaded]);
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
          {uploading
            ? `上載中 ${progress?.done ?? 0}/${progress?.total ?? 0}`
            : "上載相片"}
        </Button>
        <Input
          ref={inputRef}
          type="file"
          accept={ACCEPT.join(",")}
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <p className="text-xs text-muted-foreground">
          JPG / PNG / WEBP / AVIF，每張 ≤ 5MB。第一張為封面。
        </p>
      </div>

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
                  className="rounded bg-background/90 p-1 text-foreground opacity-0 transition group-hover:opacity-100 hover:bg-destructive hover:text-destructive-foreground"
                  aria-label="移除"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
              <span className="absolute bottom-1.5 left-1.5 cursor-grab rounded bg-background/90 p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100">
                <GripVertical className="h-3.5 w-3.5" />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
