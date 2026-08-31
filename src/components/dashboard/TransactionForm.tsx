import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { fetchAdminEstateOptions, saveAdminTransaction } from "@/lib/neon/admin-data";
import type { AdminTransactionInput, AdminTransactionRow } from "@/lib/neon/admin-data.types";

// The create route has nothing to pass (undefined); the edit route passes
// the real AdminTransactionRow fetched from the server -- NOT
// AdminTransactionInput, which is the write shape (has `verified: boolean`,
// not `published`/`verification_state`). Typing this as
// `Partial<AdminTransactionInput>` would silently accept the wrong shape,
// since AdminTransactionRow.deal_type is plain `string` (from the DB row
// mapper), not the narrower "sale" | "rent" union -- a real assignability
// error if the two are conflated.
type Transaction = AdminTransactionRow;
type Estate = { id: string; name_zh: string; district_slug: string };

const blankToNull = (value: unknown) => {
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
};

const optionalText = z.preprocess(blankToNull, z.string().trim().max(60).nullable());

const schema = z.object({
  estate_id: z.string().uuid("請選擇屋苑"),
  deal_type: z.enum(["sale", "rent"], { message: "請選擇買賣或租賃" }),
  price: z.coerce.number({ invalid_type_error: "請輸入數字" }).positive("請輸入大於 0 的數字"),
  saleable_area: z.coerce
    .number({ invalid_type_error: "請輸入數字" })
    .positive("請輸入大於 0 的數字"),
  deal_date: z.string().trim().min(1, "請輸入成交日期"),
  unit: optionalText,
  block: optionalText,
  floor_band: optionalText,
  source: optionalText,
  source_url: z
    .string()
    .trim()
    .url("請輸入有效連結")
    .max(500)
    .optional()
    .or(z.literal(""))
    .transform((v) => v || null),
  verified: z.boolean(),
});

function createInitialForm(transaction?: Transaction, staffName?: string) {
  return {
    estate_id: transaction?.estate_id ?? "",
    deal_type: (transaction?.deal_type === "rent" ? "rent" : "sale") as "sale" | "rent",
    price: transaction?.price?.toString() ?? "",
    saleable_area: transaction?.saleable_area?.toString() ?? "",
    deal_date: transaction?.deal_date ?? "",
    unit: transaction?.unit ?? "",
    block: transaction?.block ?? "",
    floor_band: transaction?.floor_band ?? "",
    source: transaction?.source ?? staffName ?? "",
    source_url: transaction?.source_url ?? "",
    verified: transaction?.published ?? false,
  };
}

type FormState = ReturnType<typeof createInitialForm>;

function mapTransactionSaveError(error: string): string {
  if (/^not found$/i.test(error.trim())) {
    return "找不到此成交記錄，可能已被刪除或你沒有權限編輯。";
  }
  return `儲存失敗，請稍後再試。（${error}）`;
}

type Props = {
  transaction?: Transaction;
  staffName?: string;
  onSaved: (id: string) => void;
};

export function TransactionForm({ transaction, staffName, onSaved }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [estates, setEstates] = useState<Estate[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(() => createInitialForm(transaction, staffName));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  useEffect(() => {
    fetchAdminEstateOptions()
      .then((data) => setEstates(data as Estate[]))
      .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
  }, []);

  function focusField(field: string) {
    if (!field) return;
    const control = formRef.current?.elements.namedItem(field);
    if (control instanceof HTMLElement) control.focus();
  }

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setFieldErrors((current) => {
      if (!current[k]) return current;
      const next = { ...current };
      delete next[k];
      return next;
    });
  }

  function fieldProps(k: keyof FormState) {
    const error = fieldErrors[k];
    return {
      name: k,
      "aria-invalid": Boolean(error),
      "aria-describedby": error ? `${k}-error` : undefined,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      const nextErrors: Partial<Record<keyof FormState, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && key in form && !nextErrors[key as keyof FormState]) {
          nextErrors[key as keyof FormState] = issue.message;
        }
      }
      setFieldErrors(nextErrors);
      toast.error("請檢查輸入資料");
      focusField(String(parsed.error.issues[0]?.path[0] ?? ""));
      return;
    }

    setFieldErrors({});
    const d = parsed.data;
    const payload: AdminTransactionInput = {
      id: transaction?.id,
      estate_id: d.estate_id,
      deal_type: d.deal_type,
      price: d.price,
      saleable_area: d.saleable_area,
      deal_date: d.deal_date,
      unit: d.unit,
      block: d.block,
      floor_band: d.floor_band,
      source: d.source,
      source_url: d.source_url,
      verified: d.verified,
    };

    setSubmitting(true);
    const result = await saveAdminTransaction({ data: payload }).catch((err) => ({
      error: err instanceof Error ? err.message : String(err),
      id: null,
    }));
    setSubmitting(false);

    if ("error" in result && result.error) {
      toast.error(mapTransactionSaveError(result.error));
      return;
    }
    toast.success(transaction ? "已更新" : "已新增");
    if (result.id) onSaved(result.id);
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-6" noValidate>
      <Section title="成交資料">
        <Field label="屋苑 *" htmlFor="estate_id" error={fieldErrors.estate_id}>
          <Select value={form.estate_id} onValueChange={(v) => set("estate_id", v)}>
            <SelectTrigger id="estate_id" {...fieldProps("estate_id")}>
              <SelectValue placeholder="請選擇屋苑" />
            </SelectTrigger>
            <SelectContent>
              {estates.map((estate) => (
                <SelectItem key={estate.id} value={estate.id}>
                  {estate.name_zh}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="類型 *" htmlFor="deal_type" error={fieldErrors.deal_type}>
          <Select
            value={form.deal_type}
            onValueChange={(v) => set("deal_type", v as "sale" | "rent")}
          >
            <SelectTrigger id="deal_type" {...fieldProps("deal_type")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sale">買賣</SelectItem>
              <SelectItem value="rent">租賃</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field
          label={form.deal_type === "rent" ? "月租 *" : "成交價 *"}
          htmlFor="price"
          error={fieldErrors.price}
        >
          <Input
            id="price"
            type="number"
            min="0"
            {...fieldProps("price")}
            value={form.price}
            onChange={(e) => set("price", e.target.value)}
            required
          />
        </Field>
        <Field label="實用面積（呎）*" htmlFor="saleable_area" error={fieldErrors.saleable_area}>
          <Input
            id="saleable_area"
            type="number"
            min="0"
            {...fieldProps("saleable_area")}
            value={form.saleable_area}
            onChange={(e) => set("saleable_area", e.target.value)}
            required
          />
        </Field>
        <Field label="成交日期 *" htmlFor="deal_date" error={fieldErrors.deal_date}>
          <Input
            id="deal_date"
            type="date"
            {...fieldProps("deal_date")}
            value={form.deal_date}
            onChange={(e) => set("deal_date", e.target.value)}
            required
          />
        </Field>
        <Field label="座數" htmlFor="block" error={fieldErrors.block}>
          <Input
            id="block"
            {...fieldProps("block")}
            value={form.block}
            onChange={(e) => set("block", e.target.value)}
            maxLength={60}
          />
        </Field>
        <Field label="單位" htmlFor="unit" error={fieldErrors.unit}>
          <Input
            id="unit"
            {...fieldProps("unit")}
            value={form.unit}
            onChange={(e) => set("unit", e.target.value)}
            maxLength={60}
          />
        </Field>
        <Field label="樓層" htmlFor="floor_band" error={fieldErrors.floor_band}>
          <Input
            id="floor_band"
            {...fieldProps("floor_band")}
            value={form.floor_band}
            onChange={(e) => set("floor_band", e.target.value)}
            maxLength={60}
            placeholder="例：高層 / 中層 / 低層"
          />
        </Field>
        <Field label="來源" htmlFor="source" error={fieldErrors.source}>
          <Input
            id="source"
            {...fieldProps("source")}
            value={form.source}
            onChange={(e) => set("source", e.target.value)}
            maxLength={60}
          />
        </Field>
        <Field label="來源連結" htmlFor="source_url" error={fieldErrors.source_url}>
          <Input
            id="source_url"
            {...fieldProps("source_url")}
            value={form.source_url}
            onChange={(e) => set("source_url", e.target.value)}
            maxLength={500}
          />
        </Field>
        <Field label="已核實並發布" htmlFor="verified" error={fieldErrors.verified}>
          <div className="flex h-10 items-center">
            <Switch
              id="verified"
              {...fieldProps("verified")}
              checked={form.verified}
              onCheckedChange={(v) => set("verified", v)}
            />
          </div>
        </Field>
      </Section>

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="submit" disabled={submitting}>
          {submitting ? "儲存中…" : transaction ? "更新成交" : "建立成交"}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
  error,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  error?: string;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor} className="mb-1.5 block">
        {label}
      </Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1.5 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
