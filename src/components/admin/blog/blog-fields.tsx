import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { PageCopy } from "@/lib/blog/types";
export function Field({
  label,
  value,
  onChange,
  multiline = false,
  readOnly = false,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  multiline?: boolean;
  readOnly?: boolean;
  required?: boolean;
}) {
  const props = {
    "aria-label": label,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(e.target.value),
    readOnly,
    required,
  };
  return (
    <label className="grid min-w-0 gap-1 text-sm font-medium">
      {label}
      {multiline ? <Textarea {...props} rows={4} /> : <Input {...props} />}
    </label>
  );
}
export function CopyFields({
  value,
  onChange,
  headingRequired = false,
}: {
  value: PageCopy;
  onChange: (copy: PageCopy) => void;
  headingRequired?: boolean;
}) {
  return (
    <div className="grid gap-3">
      <Field
        label="頁面標題"
        required={headingRequired}
        value={value.heading}
        onChange={(heading) => onChange({ ...value, heading })}
      />
      <Field
        label="介紹"
        multiline
        value={value.introduction}
        onChange={(introduction) => onChange({ ...value, introduction })}
      />
      <Field
        label="SEO 標題"
        value={value.seoTitle ?? ""}
        onChange={(seoTitle) => onChange({ ...value, seoTitle: seoTitle || null })}
      />
      <Field
        label="SEO 描述"
        multiline
        value={value.seoDescription ?? ""}
        onChange={(seoDescription) =>
          onChange({ ...value, seoDescription: seoDescription || null })
        }
      />
    </div>
  );
}
