import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { toast } from "sonner";

import { AdminContentCopilot } from "@/components/admin/AdminContentCopilot";
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
import { fetchAdminAgents, fetchAdminEstateOptions } from "@/lib/neon/admin-data";
import { saveAdminTransaction } from "@/lib/neon/admin-transactions";
import type {
  AdminTransactionInput,
  AdminTransactionRow,
} from "@/lib/neon/admin-transactions.types";

type EstateOption = { id: string; name_zh: string; district_slug: string };
type AgentOption = { id: string; name: string };

const NO_AGENT = "none";

function createInitialForm(transaction?: Partial<AdminTransactionRow>) {
  return {
    id: transaction?.id,
    estate_id: transaction?.estate_id ?? "",
    unit: transaction?.unit ?? "",
    deal_type: transaction?.deal_type ?? "sale",
    price: transaction?.price?.toString() ?? "",
    saleable_area: transaction?.saleable_area?.toString() ?? "",
    saleable_psf: transaction?.saleable_psf?.toString() ?? "",
    deal_date: transaction?.deal_date ?? "",
    block: transaction?.block ?? "",
    floor_band: transaction?.floor_band ?? "",
    source: transaction?.source ?? "",
    source_url: transaction?.source_url ?? "",
    agent_id: transaction?.agent_id ?? "",
    social_copy_fb: transaction?.social_copy_fb ?? null,
    social_copy_ig: transaction?.social_copy_ig ?? null,
  };
}

type FormState = ReturnType<typeof createInitialForm>;

export function AdminTransactionForm({
  transaction,
  onSaved,
}: {
  transaction?: Partial<AdminTransactionRow>;
  onSaved: (id: string) => void;
}) {
  const [form, setForm] = useState<FormState>(() => createInitialForm(transaction));
  const [submitting, setSubmitting] = useState(false);
  const [estates, setEstates] = useState<EstateOption[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);

  useEffect(() => {
    fetchAdminEstateOptions()
      .then((data) => setEstates(data as EstateOption[]))
      .catch(() => undefined);
    fetchAdminAgents()
      .then((data) => setAgents(data as AgentOption[]))
      .catch(() => undefined);
  }, []);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  // Mirrors admin-transactions.server.ts's validateTransactionInput -- fast
  // client-side feedback, but the server stays authoritative.
  function clientValidate(): string | null {
    if (!form.estate_id) return "請選擇屋苑";
    const price = Number(form.price);
    const area = Number(form.saleable_area);
    const psf = Number(form.saleable_psf);
    if (!(price > 0)) return "成交價必須大於零";
    if (!(area > 0)) return "實用面積必須大於零";
    const expectedPsf = price / area;
    if (Math.abs(psf - expectedPsf) / expectedPsf > 0.05) {
      return `實呎叫價 $${psf} 與成交價/面積計算值 $${Math.round(expectedPsf)} 不符（超過 5%），請確認`;
    }
    if (!form.deal_date) return "請輸入成交日期";
    if (new Date(form.deal_date).getTime() > Date.now()) return "成交日期不能是未來日期";
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = clientValidate();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSubmitting(true);
    try {
      const payload: AdminTransactionInput = {
        id: form.id,
        estate_id: form.estate_id,
        unit: form.unit.trim() || null,
        deal_type: form.deal_type as "sale" | "rent",
        price: Number(form.price),
        saleable_area: Number(form.saleable_area),
        saleable_psf: Number(form.saleable_psf),
        deal_date: form.deal_date,
        block: form.block.trim() || null,
        floor_band: form.floor_band.trim() || null,
        source: form.source.trim() || null,
        source_url: form.source_url.trim() || null,
        agent_id: form.agent_id || null,
        social_copy_fb: form.social_copy_fb,
        social_copy_ig: form.social_copy_ig,
      };
      const result = await saveAdminTransaction({ data: payload });
      toast.success(form.id ? "成交記錄已更新" : "成交記錄已新增");
      onSaved(result.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "未能儲存成交記錄");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-7" noValidate>
      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">成交資料</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="屋苑" htmlFor="estate_id">
            <Select value={form.estate_id} onValueChange={(value) => set("estate_id", value)}>
              <SelectTrigger id="estate_id">
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
          <Field label="買賣／租賃" htmlFor="deal_type">
            <Select
              value={form.deal_type}
              onValueChange={(value) => set("deal_type", value as "sale" | "rent")}
            >
              <SelectTrigger id="deal_type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sale">買賣</SelectItem>
                <SelectItem value="rent">租賃</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="座數" htmlFor="block">
            <Input id="block" value={form.block} onChange={(e) => set("block", e.target.value)} />
          </Field>
          <Field label="單位" htmlFor="unit">
            <Input id="unit" value={form.unit} onChange={(e) => set("unit", e.target.value)} />
          </Field>
          <Field label="樓層範圍" htmlFor="floor_band">
            <Input
              id="floor_band"
              value={form.floor_band}
              onChange={(e) => set("floor_band", e.target.value)}
              placeholder="例：高層 / 中層 / 低層"
            />
          </Field>
          <Field label="成交日期" htmlFor="deal_date">
            <Input
              id="deal_date"
              type="date"
              value={form.deal_date}
              onChange={(e) => set("deal_date", e.target.value)}
            />
          </Field>
          <Field label="成交價（HKD）" htmlFor="price">
            <Input
              id="price"
              type="number"
              min="0"
              value={form.price}
              onChange={(e) => set("price", e.target.value)}
            />
          </Field>
          <Field label="實用面積（呎）" htmlFor="saleable_area">
            <Input
              id="saleable_area"
              type="number"
              min="0"
              value={form.saleable_area}
              onChange={(e) => set("saleable_area", e.target.value)}
            />
          </Field>
          <Field label="實呎叫價（HKD）" htmlFor="saleable_psf">
            <Input
              id="saleable_psf"
              type="number"
              min="0"
              value={form.saleable_psf}
              onChange={(e) => set("saleable_psf", e.target.value)}
            />
          </Field>
          <Field label="負責代理" htmlFor="agent_id">
            <Select
              value={form.agent_id || NO_AGENT}
              onValueChange={(value) => set("agent_id", value === NO_AGENT ? "" : value)}
            >
              <SelectTrigger id="agent_id">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_AGENT}>未指定</SelectItem>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">資料來源</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="來源" htmlFor="source">
            <Input
              id="source"
              value={form.source}
              onChange={(e) => set("source", e.target.value)}
              placeholder="例：土地註冊處、代理提供"
            />
          </Field>
          <Field label="來源連結" htmlFor="source_url">
            <Input
              id="source_url"
              type="url"
              value={form.source_url}
              onChange={(e) => set("source_url", e.target.value)}
            />
          </Field>
        </div>
      </section>
      {form.id ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">社交媒體文案</h2>
          <AdminContentCopilot
            resourceType="transaction"
            resourceId={form.id}
            fingerprintValues={{
              social_copy_fb: form.social_copy_fb,
              social_copy_ig: form.social_copy_ig,
              created_at: transaction?.created_at ?? null,
            }}
            values={{ social_copy_fb: form.social_copy_fb, social_copy_ig: form.social_copy_ig }}
            onApply={(patch) => setForm((current) => ({ ...current, ...patch }))}
          />
        </section>
      ) : null}
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="submit" disabled={submitting}>
          {submitting ? "儲存中…" : form.id ? "儲存變更" : "建立成交記錄"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor} className="mb-1.5 block">
        {label}
      </Label>
      {children}
    </div>
  );
}
