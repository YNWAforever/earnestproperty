import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AdminContentCopilot } from "@/components/admin/AdminContentCopilot";
import { ImageUploader } from "./ImageUploader";
import {
  applyPropertyContentCopilotPatch,
  buildPropertyContentCopilotFields,
  buildPropertyContentCopilotFingerprintValues,
  normalizePropertyFeatures,
} from "./property-form-content";
import {
  fetchAdminAgents,
  fetchAdminEstateOptions,
  saveAdminProperty,
} from "@/lib/neon/admin-data";
import type { AdminAgentRow, AdminPropertyInput } from "@/lib/neon/admin-data.types";

type Property = Partial<AdminPropertyInput> & { id?: string };
type Estate = { id: string; name_zh: string; district_slug: string };
type Agent = AdminAgentRow;

const blankToNull = (value: unknown) => {
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
};

const optionalNumber = z.preprocess(blankToNull, z.coerce.number().nonnegative().nullable());

function optionalInteger(max?: number) {
  const base = z.coerce.number().int().min(0);
  return z.preprocess(blankToNull, (max === undefined ? base : base.max(max)).nullable());
}

const schema = z.object({
  listing_no: z.string().trim().min(1, "請輸入編號").max(40),
  title_zh: z.string().trim().min(1, "請輸入標題").max(200),
  title_en: z.string().trim().max(200).optional().or(z.literal("")),
  deal_type: z.enum(["sale", "rent"]),
  estate_id: z.string().uuid().optional().or(z.literal("")),
  district_slug: z.string().trim().min(1).max(60),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  price: optionalNumber,
  rent: optionalNumber,
  saleable_area: optionalInteger(),
  bedrooms: optionalInteger(20),
  bathrooms: optionalInteger(20),
  floor: z.string().trim().max(40).optional().or(z.literal("")),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  features: z.string().trim().max(3000).optional().or(z.literal("")),
  video_url: z.string().trim().url("請輸入有效影片連結").max(500).optional().or(z.literal("")),
  seo_title: z.string().trim().max(200).optional().or(z.literal("")),
  seo_description: z.string().trim().max(300).optional().or(z.literal("")),
  agent_id: z.string().uuid().optional().or(z.literal("")),
  status: z.enum(["draft", "active", "sold", "rented", "offline"]),
  featured: z.boolean(),
});

type Props = {
  property?: Property;
  onSaved: (id: string) => void;
};

export function PropertyForm({ property, onSaved }: Props) {
  const [estates, setEstates] = useState<Estate[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    listing_no: property?.listing_no ?? "",
    title_zh: property?.title_zh ?? "",
    title_en: property?.title_en ?? "",
    deal_type: (property?.deal_type ?? "sale") as "sale" | "rent",
    estate_id: property?.estate_id ?? "",
    district_slug: property?.district_slug ?? "sham-tseng",
    address: property?.address ?? "",
    price: property?.price?.toString() ?? "",
    rent: property?.rent?.toString() ?? "",
    saleable_area: property?.saleable_area?.toString() ?? "",
    bedrooms: property?.bedrooms?.toString() ?? "",
    bathrooms: property?.bathrooms?.toString() ?? "",
    floor: property?.floor ?? "",
    description: property?.description ?? "",
    features: Array.isArray(property?.features) ? property.features.join("\n") : "",
    video_url: property?.video_url ?? "",
    seo_title: property?.seo_title ?? "",
    seo_description: property?.seo_description ?? "",
    agent_id: property?.agent_id ?? "",
    status: (property?.status ?? "draft") as "draft" | "active" | "sold" | "rented" | "offline",
    featured: property?.featured ?? false,
  });
  const [images, setImages] = useState<string[]>(property?.images ?? []);

  useEffect(() => {
    Promise.all([fetchAdminEstateOptions(), fetchAdminAgents()])
      .then(([estateData, agentData]) => {
        setEstates(estateData as Estate[]);
        setAgents(agentData as Agent[]);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
  }, []);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "請檢查輸入");
      return;
    }
    const d = parsed.data;

    const payload: AdminPropertyInput = {
      id: property?.id,
      listing_no: d.listing_no,
      title_zh: d.title_zh,
      title_en: d.title_en || null,
      deal_type: d.deal_type,
      estate_id: d.estate_id || null,
      district_slug: d.district_slug,
      address: d.address || null,
      price: d.price,
      rent: d.rent,
      saleable_area: d.saleable_area,
      bedrooms: d.bedrooms,
      bathrooms: d.bathrooms,
      floor: d.floor || null,
      description: d.description || null,
      features: normalizePropertyFeatures(d.features),
      video_url: d.video_url || null,
      status: d.status,
      featured: d.featured,
      images,
      agent_id: d.agent_id || null,
      seo_title: d.seo_title || null,
      seo_description: d.seo_description || null,
    };

    setSubmitting(true);
    const result = await saveAdminProperty({ data: payload }).catch((err) => ({
      error: err instanceof Error ? err.message : String(err),
      id: null,
    }));
    setSubmitting(false);

    if ("error" in result && result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(property ? "已更新" : "已新增");
    if (result.id) onSaved(result.id);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Section title="基本資料">
        <Field label="放盤編號 *">
          <Input
            value={form.listing_no}
            onChange={(e) => set("listing_no", e.target.value)}
            required
            maxLength={40}
          />
        </Field>
        <Field label="標題 *">
          <Input
            value={form.title_zh}
            onChange={(e) => set("title_zh", e.target.value)}
            required
            maxLength={200}
          />
        </Field>
        <Field label="類型 *">
          <Select
            value={form.deal_type}
            onValueChange={(v) => set("deal_type", v as "sale" | "rent")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sale">售盤</SelectItem>
              <SelectItem value="rent">租盤</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="狀態">
          <Select value={form.status} onValueChange={(v) => set("status", v as typeof form.status)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">草稿</SelectItem>
              <SelectItem value="active">在售/在租</SelectItem>
              <SelectItem value="sold">已售出</SelectItem>
              <SelectItem value="rented">已租出</SelectItem>
              <SelectItem value="offline">下架</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="負責代理">
          <Select
            value={form.agent_id || "none"}
            onValueChange={(v) => set("agent_id", v === "none" ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="選擇代理" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— 未指定 —</SelectItem>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name ?? agent.email ?? "未命名代理"}
                  {agent.active ? "" : "（停用）"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Section>

      <Section title="位置">
        <Field label="屋苑">
          <Select
            value={form.estate_id || "none"}
            onValueChange={(v) => {
              const id = v === "none" ? "" : v;
              const est = estates.find((e) => e.id === id);
              set("estate_id", id);
              if (est) set("district_slug", est.district_slug);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="選擇屋苑" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— 無 —</SelectItem>
              {estates.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name_zh}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="地區 slug *">
          <Input
            value={form.district_slug}
            onChange={(e) => set("district_slug", e.target.value)}
            required
            maxLength={60}
          />
        </Field>
        <Field label="地址" full>
          <Input
            value={form.address}
            onChange={(e) => set("address", e.target.value)}
            maxLength={300}
          />
        </Field>
      </Section>

      <Section title="價格 / 規格">
        <Field label="售價（HKD）">
          <Input
            type="number"
            min="0"
            value={form.price}
            onChange={(e) => set("price", e.target.value)}
          />
        </Field>
        <Field label="月租（HKD）">
          <Input
            type="number"
            min="0"
            value={form.rent}
            onChange={(e) => set("rent", e.target.value)}
          />
        </Field>
        <Field label="實用面積（呎）">
          <Input
            type="number"
            min="0"
            value={form.saleable_area}
            onChange={(e) => set("saleable_area", e.target.value)}
          />
        </Field>
        <Field label="樓層">
          <Input value={form.floor} onChange={(e) => set("floor", e.target.value)} maxLength={40} />
        </Field>
        <Field label="房">
          <Input
            type="number"
            min="0"
            max="20"
            value={form.bedrooms}
            onChange={(e) => set("bedrooms", e.target.value)}
          />
        </Field>
        <Field label="廁">
          <Input
            type="number"
            min="0"
            max="20"
            value={form.bathrooms}
            onChange={(e) => set("bathrooms", e.target.value)}
          />
        </Field>
      </Section>

      <Section title="內容">
        <Field label="描述" full>
          <Textarea
            rows={4}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            maxLength={4000}
          />
        </Field>
        <Field label="YouTube影片連結" full>
          <Input
            type="url"
            value={form.video_url}
            onChange={(e) => set("video_url", e.target.value)}
            maxLength={500}
            placeholder="https://www.youtube.com/watch?v=..."
          />
        </Field>
        <Field label="English title" full>
          <Input
            value={form.title_en}
            onChange={(e) => set("title_en", e.target.value)}
            maxLength={200}
          />
        </Field>
        <Field label="Features (one per line)" full>
          <Textarea
            rows={4}
            value={form.features}
            onChange={(e) => set("features", e.target.value)}
            maxLength={3000}
          />
        </Field>
        <Field label="SEO 標題" full>
          <Input
            value={form.seo_title}
            onChange={(e) => set("seo_title", e.target.value)}
            maxLength={200}
          />
        </Field>
        <Field label="SEO 描述" full>
          <Textarea
            rows={3}
            value={form.seo_description}
            onChange={(e) => set("seo_description", e.target.value)}
            maxLength={300}
          />
        </Field>
        <Field label="相片" full>
          <ImageUploader ownerType="property" value={images} onChange={setImages} />
        </Field>
        <Field label="精選">
          <div className="flex h-10 items-center">
            <Switch checked={form.featured} onCheckedChange={(v) => set("featured", v)} />
          </div>
        </Field>
      </Section>

      <AdminContentCopilot
        resourceType="listing"
        resourceId={property?.id ?? null}
        values={buildPropertyContentCopilotFields(form)}
        fingerprintValues={buildPropertyContentCopilotFingerprintValues({
          ...property,
          id: property?.id,
          title_zh: form.title_zh,
          title_en: form.title_en,
          description: form.description,
          features: normalizePropertyFeatures(form.features),
          seo_title: form.seo_title,
          seo_description: form.seo_description,
        })}
        onApply={(patch) => setForm((current) => applyPropertyContentCopilotPatch(current, patch))}
      />
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="submit" disabled={submitting}>
          {submitting ? "儲存中…" : property ? "更新放盤" : "建立放盤"}
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
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <Label className="mb-1.5 block">{label}</Label>
      {children}
    </div>
  );
}
