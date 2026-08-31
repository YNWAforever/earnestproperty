import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { History, Save, Upload } from "lucide-react";
import { toast } from "sonner";

import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteAdminFaq,
  fetchAdminCms,
  fetchAdminDistrictOptions,
  saveAdminFaq,
} from "@/lib/neon/admin-data";
import type { AdminFaqCmsRow } from "@/lib/neon/admin-data.types";
import {
  archiveAdminCmsResource,
  fetchAdminCmsEditor,
  publishAdminCmsRevision,
  restoreAdminCmsRevision,
  saveAdminCmsDraft,
} from "@/lib/neon/admin-cms";
import type { CmsPayloadValue, CmsRevisionSummary } from "@/lib/neon/admin-cms.types";
import { EstatePreviewCard } from "./EstatePreviewCard";

type DistrictOption = { id: string; slug: string; name_zh: string };

function splitList(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function createInitialForm(payload?: Record<string, CmsPayloadValue> | null, resourceId?: string) {
  const p = payload ?? {};
  return {
    id: resourceId,
    slug: typeof p.slug === "string" ? p.slug : "",
    name_zh: typeof p.name_zh === "string" ? p.name_zh : "",
    name_en: typeof p.name_en === "string" ? p.name_en : "",
    district_slug: typeof p.district_slug === "string" ? p.district_slug : "",
    developer: typeof p.developer === "string" ? p.developer : "",
    year_completed: p.year_completed != null ? String(p.year_completed) : "",
    phases: p.phases != null ? String(p.phases) : "",
    total_units: p.total_units != null ? String(p.total_units) : "",
    area_min: p.area_min != null ? String(p.area_min) : "",
    area_max: p.area_max != null ? String(p.area_max) : "",
    description: typeof p.description === "string" ? p.description : "",
    hero_image: typeof p.hero_image === "string" ? p.hero_image : "",
    facilities: Array.isArray(p.facilities) ? p.facilities.join("\n") : "",
    seo_title: typeof p.seo_title === "string" ? p.seo_title : "",
    seo_description: typeof p.seo_description === "string" ? p.seo_description : "",
    aliases: Array.isArray(p.aliases) ? p.aliases.join("\n") : "",
    address: typeof p.address === "string" ? p.address : "",
    blocks: p.blocks != null ? String(p.blocks) : "",
    school_net_code: typeof p.school_net_code === "string" ? p.school_net_code : "",
    transport_note: typeof p.transport_note === "string" ? p.transport_note : "",
    district_id: typeof p.district_id === "string" ? p.district_id : "",
    avg_saleable_psf: p.avg_saleable_psf != null ? String(p.avg_saleable_psf) : "",
    lat: p.lat != null ? String(p.lat) : "",
    lng: p.lng != null ? String(p.lng) : "",
    verified_at: typeof p.verified_at === "string" ? p.verified_at : null,
  };
}

type FormState = ReturnType<typeof createInitialForm>;

function parseNullableNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Builds the CMS draft payload from form state -- every estate field, not
 * just the ones this form's own UI exposes, since it always starts from a
 * full fetched payload (see createInitialForm) and only overlays edits. */
function buildPayload(form: FormState): Record<string, unknown> {
  return {
    slug: form.slug.trim(),
    name_zh: form.name_zh.trim(),
    name_en: form.name_en.trim() || null,
    district_slug: form.district_slug.trim(),
    developer: form.developer.trim() || null,
    year_completed: parseNullableNumber(form.year_completed),
    phases: parseNullableNumber(form.phases),
    total_units: parseNullableNumber(form.total_units),
    area_min: parseNullableNumber(form.area_min),
    area_max: parseNullableNumber(form.area_max),
    description: form.description.trim() || null,
    hero_image: form.hero_image.trim() || null,
    facilities: splitList(form.facilities),
    seo_title: form.seo_title.trim() || null,
    seo_description: form.seo_description.trim() || null,
    aliases: splitList(form.aliases),
    address: form.address.trim() || null,
    blocks: parseNullableNumber(form.blocks),
    school_net_code: form.school_net_code.trim() || null,
    transport_note: form.transport_note.trim() || null,
    district_id: form.district_id || null,
    avg_saleable_psf: parseNullableNumber(form.avg_saleable_psf),
    lat: parseNullableNumber(form.lat),
    lng: parseNullableNumber(form.lng),
    verified_at: form.verified_at,
  };
}

const CMS_ERROR_MESSAGES: Record<string, string> = {
  CMS_REVISION_CONFLICT: "此草稿的發布版本已被其他人更新，請重新載入頁面後再試一次。",
  CMS_REVISION_NOT_FOUND: "找不到此版本，可能已被更新，請重新載入頁面。",
  CMS_REVISION_MISMATCH: "版本資料不符，請重新載入頁面後再試一次。",
  CMS_RESOURCE_NOT_FOUND: "找不到此資源，可能已被其他人刪除或封存，請重新載入頁面。",
};

function cmsErrorMessage(code: string): string {
  return CMS_ERROR_MESSAGES[code] ?? "操作失敗，請重試。";
}

async function callCms<T>(call: () => Promise<T>): Promise<T> {
  let result: T;
  try {
    result = await call();
  } catch (err) {
    const status =
      err && typeof err === "object" && "status" in err
        ? Number((err as { status?: unknown }).status)
        : 0;
    if (status === 401) throw new Error("登入已過期，請重新登入後再試。");
    if (status === 403) throw new Error("你的角色沒有此操作的權限，請聯絡管理員或主管。");
    throw new Error(cmsErrorMessage(err instanceof Error ? err.message : String(err)));
  }
  if (
    result &&
    typeof result === "object" &&
    "ok" in result &&
    (result as { ok: unknown }).ok === false
  ) {
    const code = "code" in result ? String((result as { code?: unknown }).code) : "";
    throw new Error(cmsErrorMessage(code));
  }
  return result;
}

const REVISION_STATE_LABELS: Record<string, string> = {
  draft: "草稿",
  published: "已發布",
  superseded: "已被取代",
  archived: "已封存",
};

export function AdminEstateEditorForm({
  resourceId,
  payload,
  onSaved,
}: {
  resourceId?: string;
  payload?: Record<string, CmsPayloadValue> | null;
  onSaved: (resourceId: string) => void;
}) {
  const [form, setForm] = useState<FormState>(() => createInitialForm(payload, resourceId));
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [districts, setDistricts] = useState<DistrictOption[]>([]);
  const [revisions, setRevisions] = useState<CmsRevisionSummary[] | null>(null);
  const [faqs, setFaqs] = useState<AdminFaqCmsRow[] | null>(null);
  const [editingFaq, setEditingFaq] = useState<{
    id?: string;
    question: string;
    answer: string;
  } | null>(null);

  useEffect(() => {
    fetchAdminDistrictOptions()
      .then((data) => setDistricts(data as DistrictOption[]))
      .catch(() => undefined);
  }, []);

  async function refreshRevisions(id: string | undefined) {
    if (!id) {
      setRevisions(null);
      return;
    }
    try {
      const result = await fetchAdminCmsEditor({
        data: { resourceType: "estate", resourceId: id },
      });
      setRevisions(result.revisions);
    } catch {
      setRevisions(null);
    }
  }

  async function refreshFaqs(slug: string) {
    if (!slug) {
      setFaqs(null);
      return;
    }
    try {
      const cms = await fetchAdminCms();
      const scope = `estate:${slug}`;
      setFaqs((cms.faqs as AdminFaqCmsRow[]).filter((faq) => faq.scope === scope));
    } catch {
      setFaqs(null);
    }
  }

  useEffect(() => {
    void refreshRevisions(resourceId);
    if (form.slug) void refreshFaqs(form.slug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function validate(): string | null {
    if (!form.slug.trim()) return "請填寫 Slug";
    if (!form.name_zh.trim()) return "請填寫中文名";
    if (!form.district_slug.trim()) return "請填寫地區 slug";
    return null;
  }

  async function handleSaveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validate();
    if (error) {
      toast.error(error);
      return;
    }
    setSaving(true);
    try {
      const result = await callCms(() =>
        saveAdminCmsDraft({
          data: { resourceType: "estate", resourceId: form.id, payload: buildPayload(form) },
        }),
      );
      set("id", result.resourceId);
      onSaved(result.resourceId);
      await refreshRevisions(result.resourceId);
      await refreshFaqs(form.slug);
      toast.success("草稿已儲存");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "未能儲存草稿");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    const error = validate();
    if (error) {
      toast.error(error);
      return;
    }
    setPublishing(true);
    try {
      const draft = await callCms(() =>
        saveAdminCmsDraft({
          data: { resourceType: "estate", resourceId: form.id, payload: buildPayload(form) },
        }),
      );
      await callCms(() =>
        publishAdminCmsRevision({
          data: {
            resourceType: "estate",
            resourceId: draft.resourceId,
            revisionId: draft.revisionId,
          },
        }),
      );
      set("id", draft.resourceId);
      onSaved(draft.resourceId);
      await refreshRevisions(draft.resourceId);
      toast.success("屋苑已發布");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "未能發布");
    } finally {
      setPublishing(false);
    }
  }

  async function handleRestore(revisionId: string) {
    setSaving(true);
    try {
      const result = await callCms(() => restoreAdminCmsRevision({ data: { revisionId } }));
      const editor = await fetchAdminCmsEditor({
        data: { resourceType: "estate", resourceId: result.resourceId },
      });
      setForm(createInitialForm(editor.payload, result.resourceId));
      await refreshRevisions(result.resourceId);
      toast.success("已還原為新草稿，請檢查內容後發布");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "還原失敗");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    if (!form.id) return;
    setSaving(true);
    try {
      await callCms(() =>
        archiveAdminCmsResource({ data: { resourceType: "estate", resourceId: form.id! } }),
      );
      setArchiving(false);
      await refreshRevisions(form.id);
      toast.success("屋苑已封存");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "封存失敗");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveFaq(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingFaq || !form.slug) return;
    if (!editingFaq.question.trim() || !editingFaq.answer.trim()) {
      toast.error("請填寫問題及答案");
      return;
    }
    try {
      await saveAdminFaq({
        data: {
          id: editingFaq.id,
          scope: `estate:${form.slug}`,
          question: editingFaq.question,
          answer: editingFaq.answer,
          sort_order: 0,
        },
      });
      setEditingFaq(null);
      await refreshFaqs(form.slug);
      toast.success("FAQ 已儲存");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "未能儲存 FAQ");
    }
  }

  async function handleDeleteFaq(id: string) {
    try {
      await deleteAdminFaq({ data: { id } });
      await refreshFaqs(form.slug);
      toast.success("FAQ 已刪除");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "刪除失敗");
    }
  }

  const disabled = saving || publishing;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
      <form onSubmit={handleSaveDraft} className="space-y-7" noValidate>
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">基本資料</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Slug" htmlFor="slug">
              <Input
                id="slug"
                value={form.slug}
                onChange={(e) => set("slug", e.target.value)}
                required
              />
            </Field>
            <Field label="中文名" htmlFor="name_zh">
              <Input
                id="name_zh"
                value={form.name_zh}
                onChange={(e) => set("name_zh", e.target.value)}
                required
              />
            </Field>
            <Field label="英文名" htmlFor="name_en">
              <Input
                id="name_en"
                value={form.name_en}
                onChange={(e) => set("name_en", e.target.value)}
              />
            </Field>
            <Field label="地區 slug（舊）" htmlFor="district_slug">
              <Input
                id="district_slug"
                value={form.district_slug}
                onChange={(e) => set("district_slug", e.target.value)}
                required
              />
            </Field>
            <Field label="發展商" htmlFor="developer">
              <Input
                id="developer"
                value={form.developer}
                onChange={(e) => set("developer", e.target.value)}
              />
            </Field>
            <Field label="Hero 圖片" htmlFor="hero_image">
              <Input
                id="hero_image"
                value={form.hero_image}
                onChange={(e) => set("hero_image", e.target.value)}
              />
            </Field>
            <Field label="落成年份" htmlFor="year_completed">
              <Input
                id="year_completed"
                type="number"
                value={form.year_completed}
                onChange={(e) => set("year_completed", e.target.value)}
              />
            </Field>
            <Field label="期數" htmlFor="phases">
              <Input
                id="phases"
                type="number"
                value={form.phases}
                onChange={(e) => set("phases", e.target.value)}
              />
            </Field>
            <Field label="伙數" htmlFor="total_units">
              <Input
                id="total_units"
                type="number"
                value={form.total_units}
                onChange={(e) => set("total_units", e.target.value)}
              />
            </Field>
            <Field label="面積下限" htmlFor="area_min">
              <Input
                id="area_min"
                type="number"
                value={form.area_min}
                onChange={(e) => set("area_min", e.target.value)}
              />
            </Field>
            <Field label="面積上限" htmlFor="area_max">
              <Input
                id="area_max"
                type="number"
                value={form.area_max}
                onChange={(e) => set("area_max", e.target.value)}
              />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="設施（每行一項）" htmlFor="facilities">
              <Textarea
                id="facilities"
                value={form.facilities}
                onChange={(e) => set("facilities", e.target.value)}
                rows={3}
              />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="描述" htmlFor="description">
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                rows={4}
              />
            </Field>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">地理及交通</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="別名（每行一個）" htmlFor="aliases">
              <Textarea
                id="aliases"
                value={form.aliases}
                onChange={(e) => set("aliases", e.target.value)}
                rows={3}
              />
            </Field>
            <Field label="地址" htmlFor="address">
              <Input
                id="address"
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
              />
            </Field>
            <Field label="座數" htmlFor="blocks">
              <Input
                id="blocks"
                type="number"
                value={form.blocks}
                onChange={(e) => set("blocks", e.target.value)}
              />
            </Field>
            <Field label="地區（新，district_id）" htmlFor="district_id">
              <Select
                value={form.district_id || "none"}
                onValueChange={(value) => set("district_id", value === "none" ? "" : value)}
              >
                <SelectTrigger id="district_id">
                  <SelectValue placeholder="未指定" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未指定</SelectItem>
                  {districts.map((district) => (
                    <SelectItem key={district.id} value={district.id}>
                      {district.name_zh}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="緯度 (lat)" htmlFor="lat">
              <Input
                id="lat"
                type="number"
                step="any"
                value={form.lat}
                onChange={(e) => set("lat", e.target.value)}
              />
            </Field>
            <Field label="經度 (lng)" htmlFor="lng">
              <Input
                id="lng"
                type="number"
                step="any"
                value={form.lng}
                onChange={(e) => set("lng", e.target.value)}
              />
            </Field>
            <Field label="平均實呎 (avg_saleable_psf)" htmlFor="avg_saleable_psf">
              <Input
                id="avg_saleable_psf"
                type="number"
                value={form.avg_saleable_psf}
                onChange={(e) => set("avg_saleable_psf", e.target.value)}
              />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="交通備註" htmlFor="transport_note">
              <Textarea
                id="transport_note"
                value={form.transport_note}
                onChange={(e) => set("transport_note", e.target.value)}
                rows={3}
              />
            </Field>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">學校網及核實</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="校網編號" htmlFor="school_net_code">
              <Input
                id="school_net_code"
                value={form.school_net_code}
                onChange={(e) => set("school_net_code", e.target.value)}
              />
            </Field>
            <Field label="核實狀態" htmlFor="verified_at">
              <div className="flex min-h-11 items-center gap-3 rounded-md border px-3">
                <span className="text-sm text-muted-foreground">
                  {form.verified_at
                    ? `已核實（${new Date(form.verified_at).toLocaleDateString("zh-HK")}）`
                    : "尚未核實"}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => set("verified_at", new Date().toISOString())}
                >
                  標記為已核實
                </Button>
              </div>
            </Field>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">SEO</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="SEO 標題" htmlFor="seo_title">
              <Input
                id="seo_title"
                value={form.seo_title}
                onChange={(e) => set("seo_title", e.target.value)}
              />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="SEO 描述" htmlFor="seo_description">
              <Textarea
                id="seo_description"
                value={form.seo_description}
                onChange={(e) => set("seo_description", e.target.value)}
                rows={3}
              />
            </Field>
          </div>
        </section>

        {form.id ? (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground">屋苑 FAQ</h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditingFaq({ question: "", answer: "" })}
              >
                新增 FAQ
              </Button>
            </div>
            {faqs?.length ? (
              <ul className="space-y-2">
                {faqs.map((faq) => (
                  <li key={faq.id} className="rounded-md border p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{faq.question}</p>
                        <p className="mt-1 text-muted-foreground">{faq.answer}</p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setEditingFaq({
                              id: faq.id,
                              question: faq.question,
                              answer: faq.answer,
                            })
                          }
                        >
                          編輯
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleDeleteFaq(faq.id)}
                        >
                          刪除
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">此屋苑暫無 FAQ。</p>
            )}
          </section>
        ) : null}

        <div className="flex justify-end gap-2 border-t pt-4">
          {form.id ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => setArchiving(true)}
              disabled={disabled}
            >
              封存
            </Button>
          ) : null}
          <Button type="submit" variant="outline" disabled={disabled}>
            <Save className="h-4 w-4" />
            {saving ? "儲存中…" : "儲存草稿"}
          </Button>
          <Button type="button" onClick={handlePublish} disabled={disabled}>
            <Upload className="h-4 w-4" />
            {publishing ? "發布中…" : "發布"}
          </Button>
        </div>
      </form>

      <div className="space-y-4">
        <EstatePreviewCard form={form} />
        {form.id && revisions ? (
          <div className="rounded-md border p-4">
            <h4 className="text-sm font-semibold">版本紀錄</h4>
            {revisions.length ? (
              <ul className="mt-2 space-y-2">
                {revisions.map((revision) => (
                  <li key={revision.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2">
                      <Badge variant={revision.state === "published" ? "default" : "outline"}>
                        {REVISION_STATE_LABELS[revision.state] ?? revision.state}
                      </Badge>
                      <span className="text-muted-foreground">
                        v{revision.versionNumber} ·{" "}
                        {new Date(revision.createdAt).toLocaleDateString("zh-HK")}
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleRestore(revision.id)}
                    >
                      <History className="h-4 w-4" />
                      還原
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">暫無版本紀錄</p>
            )}
          </div>
        ) : null}
      </div>

      <Dialog
        open={editingFaq !== null}
        onOpenChange={(open) => {
          if (!open) setEditingFaq(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingFaq?.id ? "編輯 FAQ" : "新增 FAQ"}</DialogTitle>
          </DialogHeader>
          {editingFaq ? (
            <form onSubmit={handleSaveFaq} className="grid gap-4">
              <Field label="問題" htmlFor="faq_question">
                <Input
                  id="faq_question"
                  value={editingFaq.question}
                  onChange={(e) => setEditingFaq({ ...editingFaq, question: e.target.value })}
                />
              </Field>
              <Field label="答案" htmlFor="faq_answer">
                <Textarea
                  id="faq_answer"
                  value={editingFaq.answer}
                  onChange={(e) => setEditingFaq({ ...editingFaq, answer: e.target.value })}
                  rows={3}
                />
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingFaq(null)}>
                  取消
                </Button>
                <Button type="submit">儲存</Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <AdminConfirmDialog
        open={archiving}
        title="封存屋苑"
        description="確定要封存此屋苑？封存後會從公開網站下架，但可在版本紀錄中還原。"
        confirmLabel="封存"
        confirmVariant="destructive"
        isPending={saving}
        onOpenChange={setArchiving}
        onConfirm={() => void handleArchive()}
      />
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
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
