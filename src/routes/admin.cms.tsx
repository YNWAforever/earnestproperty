import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Pencil, Plus, Save } from "lucide-react";
import { toast } from "sonner";

import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import {
  fetchAdminCms,
  fetchAdminMediaAssets,
  saveAdminArticle,
  saveAdminEstate,
  saveAdminFaq,
  updateAdminMediaAsset,
} from "@/lib/neon/admin-data";
import type {
  AdminArticleCmsRow,
  AdminArticleInput,
  AdminCmsData,
  AdminEstateCmsRow,
  AdminEstateInput,
  AdminFaqCmsRow,
  AdminFaqInput,
  AdminMediaAssetRow,
} from "@/lib/neon/admin-data.types";

export const Route = createFileRoute("/admin/cms")({
  head: () => ({
    meta: [{ title: "CMS｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminCms,
});

type EditingMediaAsset = Pick<
  AdminMediaAssetRow,
  "id" | "url" | "pathname" | "alt_text" | "owner_type" | "owner_id"
>;

const emptyEstate: AdminEstateInput = {
  slug: "",
  name_zh: "",
  name_en: null,
  district_slug: "",
  developer: null,
  year_completed: null,
  phases: null,
  total_units: null,
  area_min: null,
  area_max: null,
  description: null,
  hero_image: null,
  facilities: [],
  seo_title: null,
  seo_description: null,
};

const emptyArticle: AdminArticleInput = {
  slug: "",
  title: "",
  excerpt: null,
  content: null,
  cover_image: null,
  category: null,
  reading_minutes: 5,
  published: false,
  published_at: null,
  seo_title: null,
  seo_description: null,
};

const emptyFaq: AdminFaqInput = {
  scope: "general",
  question: "",
  answer: "",
  sort_order: 0,
};

function AdminCms() {
  const { user } = useNeonAuth();
  const [data, setData] = useState<AdminCmsData | null>(null);
  const [mediaAssets, setMediaAssets] = useState<AdminMediaAssetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("estates");
  const [saving, setSaving] = useState(false);
  const [editingEstate, setEditingEstate] = useState<AdminEstateInput | null>(null);
  const [editingArticle, setEditingArticle] = useState<AdminArticleInput | null>(null);
  const [editingFaq, setEditingFaq] = useState<AdminFaqInput | null>(null);
  const [editingMedia, setEditingMedia] = useState<EditingMediaAsset | null>(null);

  const refreshCmsData = useCallback(async () => {
    const [cms, media] = await Promise.all([fetchAdminCms(), fetchAdminMediaAssets()]);
    setData(cms as AdminCmsData);
    setMediaAssets(media as AdminMediaAssetRow[]);
    setError(null);
  }, []);

  useEffect(() => {
    if (!user) return;
    refreshCmsData().catch((err) => setError(errorText(err)));
  }, [refreshCmsData, user]);

  const faqsByScope = useMemo(() => {
    const groups = new Map<string, AdminFaqCmsRow[]>();
    for (const faq of data?.faqs ?? []) {
      const existing = groups.get(faq.scope) ?? [];
      existing.push(faq);
      groups.set(faq.scope, existing);
    }
    return Array.from(groups.entries());
  }, [data?.faqs]);

  async function handleSaveEstate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingEstate) return;
    if (
      !editingEstate.slug.trim() ||
      !editingEstate.name_zh.trim() ||
      !editingEstate.district_slug.trim()
    ) {
      toast.error("請填寫屋苑 slug、中文名及地區");
      return;
    }

    setSaving(true);
    try {
      assertNoServerError(await saveAdminEstate({ data: editingEstate }));
      await refreshCmsData();
      toast.success(editingEstate.id ? "屋苑 SEO 已更新" : "屋苑 SEO 已新增");
      setEditingEstate(null);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveArticle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingArticle) return;
    if (!editingArticle.slug.trim() || !editingArticle.title.trim()) {
      toast.error("請填寫文章 slug 及標題");
      return;
    }

    setSaving(true);
    try {
      assertNoServerError(await saveAdminArticle({ data: editingArticle }));
      await refreshCmsData();
      toast.success(editingArticle.id ? "文章編輯已儲存" : "文章已新增");
      setEditingArticle(null);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveFaq(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingFaq) return;
    if (!editingFaq.scope.trim() || !editingFaq.question.trim() || !editingFaq.answer.trim()) {
      toast.error("請填寫 FAQ 分組、問題及答案");
      return;
    }

    setSaving(true);
    try {
      assertNoServerError(await saveAdminFaq({ data: editingFaq }));
      await refreshCmsData();
      toast.success(editingFaq.id ? "FAQ 編輯已儲存" : "FAQ 已新增");
      setEditingFaq(null);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveMedia(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingMedia) return;

    setSaving(true);
    try {
      assertNoServerError(
        await updateAdminMediaAsset({
          data: {
            id: editingMedia.id,
            alt_text: nullIfBlank(editingMedia.alt_text ?? ""),
            owner_type: editingMedia.owner_type,
            owner_id: editingMedia.owner_id,
          },
        }),
      );
      await refreshCmsData();
      toast.success("媒體庫資料已更新");
      setEditingMedia(null);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell title="CMS" description="管理屋苑內容、文章、FAQ 及 SEO 資料。">
      {error ? <AdminError message={error} /> : null}
      {!data && !error ? <Skeleton className="h-72 w-full" /> : null}
      {data ? (
        <>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4 grid h-auto w-full grid-cols-2 md:inline-flex md:w-auto">
              <TabsTrigger value="estates">屋苑 SEO</TabsTrigger>
              <TabsTrigger value="articles">文章編輯</TabsTrigger>
              <TabsTrigger value="faqs">FAQ 編輯</TabsTrigger>
              <TabsTrigger value="media">媒體庫</TabsTrigger>
            </TabsList>

            <TabsContent value="estates">
              <Card>
                <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle className="text-base">屋苑 SEO</CardTitle>
                    <CardDescription>SEO 標題、描述、設施及屋苑頁內容。</CardDescription>
                  </div>
                  <Button onClick={() => setEditingEstate({ ...emptyEstate })}>
                    <Plus className="h-4 w-4" />
                    新增屋苑
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  {data.estates.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>屋苑</TableHead>
                          <TableHead>地區</TableHead>
                          <TableHead className="text-right">伙數</TableHead>
                          <TableHead>SEO 標題</TableHead>
                          <TableHead className="w-28 text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.estates.map((estate) => (
                          <TableRow key={estate.id}>
                            <TableCell>
                              <p className="font-medium">{estate.name_zh}</p>
                              <p className="text-xs text-muted-foreground">{estate.slug}</p>
                            </TableCell>
                            <TableCell>{estate.district_slug}</TableCell>
                            <TableCell className="text-right">
                              {estate.total_units?.toLocaleString() ?? "—"}
                            </TableCell>
                            <TableCell className="max-w-xs truncate">
                              {estate.seo_title ?? "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setEditingEstate(estateToInput(estate))}
                              >
                                <Pencil className="h-4 w-4" />
                                編輯
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="p-6">
                      <AdminEmptyState
                        title="未有屋苑"
                        description="新增第一個屋苑後即可管理 SEO 及頁面內容。"
                        action={
                          <Button onClick={() => setEditingEstate({ ...emptyEstate })}>
                            <Plus className="h-4 w-4" />
                            新增屋苑
                          </Button>
                        }
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="articles">
              <Card>
                <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle className="text-base">文章編輯</CardTitle>
                    <CardDescription>管理文章內容、分類、發布狀態及 SEO。</CardDescription>
                  </div>
                  <Button onClick={() => setEditingArticle({ ...emptyArticle })}>
                    <Plus className="h-4 w-4" />
                    新增文章
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  {data.articles.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>標題</TableHead>
                          <TableHead>分類</TableHead>
                          <TableHead>狀態</TableHead>
                          <TableHead>SEO 標題</TableHead>
                          <TableHead className="w-28 text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.articles.map((article) => (
                          <TableRow key={article.id}>
                            <TableCell>
                              <p className="font-medium">{article.title}</p>
                              <p className="text-xs text-muted-foreground">{article.slug}</p>
                            </TableCell>
                            <TableCell>{article.category ?? "—"}</TableCell>
                            <TableCell>
                              <Badge variant={article.published ? "default" : "outline"}>
                                {article.published ? "已發布" : "草稿"}
                              </Badge>
                            </TableCell>
                            <TableCell className="max-w-xs truncate">
                              {article.seo_title ?? "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setEditingArticle(articleToInput(article))}
                              >
                                <Pencil className="h-4 w-4" />
                                編輯
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="p-6">
                      <AdminEmptyState
                        title="未有文章"
                        description="新增文章後即可管理內容及發布狀態。"
                        action={
                          <Button onClick={() => setEditingArticle({ ...emptyArticle })}>
                            <Plus className="h-4 w-4" />
                            新增文章
                          </Button>
                        }
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="faqs">
              <Card>
                <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle className="text-base">FAQ 編輯</CardTitle>
                    <CardDescription>按 scope 分組管理常見問題。</CardDescription>
                  </div>
                  <Button
                    onClick={() =>
                      setEditingFaq({
                        ...emptyFaq,
                        scope: data.faqGroups[0]?.scope ?? emptyFaq.scope,
                      })
                    }
                  >
                    <Plus className="h-4 w-4" />
                    新增 FAQ
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  {faqsByScope.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>分組</TableHead>
                          <TableHead>問題</TableHead>
                          <TableHead className="text-right">排序</TableHead>
                          <TableHead className="w-28 text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {faqsByScope.map(([scope, rows]) => (
                          <Fragment key={scope}>
                            <TableRow className="bg-muted/50">
                              <TableCell colSpan={4}>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{scope}</span>
                                  <Badge variant="secondary">{rows.length}</Badge>
                                </div>
                              </TableCell>
                            </TableRow>
                            {rows.map((faq) => (
                              <TableRow key={faq.id}>
                                <TableCell>{faq.scope}</TableCell>
                                <TableCell>
                                  <p className="font-medium">{faq.question}</p>
                                  <p className="line-clamp-1 text-xs text-muted-foreground">
                                    {faq.answer}
                                  </p>
                                </TableCell>
                                <TableCell className="text-right">{faq.sort_order}</TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setEditingFaq(faqToInput(faq))}
                                  >
                                    <Pencil className="h-4 w-4" />
                                    編輯
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </Fragment>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="p-6">
                      <AdminEmptyState
                        title="未有 FAQ"
                        description="新增 FAQ 後即可在對應頁面顯示常見問題。"
                        action={
                          <Button onClick={() => setEditingFaq({ ...emptyFaq })}>
                            <Plus className="h-4 w-4" />
                            新增 FAQ
                          </Button>
                        }
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="media">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">媒體庫</CardTitle>
                  <CardDescription>更新圖片替代文字，改善搜尋及無障礙內容。</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  {!mediaAssets ? <Skeleton className="m-6 h-48 w-auto" /> : null}
                  {mediaAssets?.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>檔案</TableHead>
                          <TableHead>類型</TableHead>
                          <TableHead>用途</TableHead>
                          <TableHead>替代文字</TableHead>
                          <TableHead className="w-28 text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {mediaAssets.map((asset) => (
                          <TableRow key={asset.id}>
                            <TableCell>
                              <a
                                href={asset.url}
                                target="_blank"
                                rel="noreferrer"
                                className="font-medium hover:underline"
                              >
                                {asset.pathname}
                              </a>
                              <p className="text-xs text-muted-foreground">
                                {formatBytes(asset.size_bytes)}
                              </p>
                            </TableCell>
                            <TableCell>{asset.content_type ?? "—"}</TableCell>
                            <TableCell>
                              {asset.owner_type}
                              {asset.owner_id ? (
                                <p className="text-xs text-muted-foreground">{asset.owner_id}</p>
                              ) : null}
                            </TableCell>
                            <TableCell className="max-w-xs truncate">
                              {asset.alt_text ?? "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setEditingMedia(mediaToInput(asset))}
                              >
                                <Pencil className="h-4 w-4" />
                                編輯
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : null}
                  {mediaAssets && !mediaAssets.length ? (
                    <div className="p-6">
                      <AdminEmptyState
                        title="未有媒體"
                        description="上載相片後即可在媒體庫管理替代文字。"
                      />
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <EstateDialog
            estate={editingEstate}
            saving={saving}
            onChange={setEditingEstate}
            onClose={() => setEditingEstate(null)}
            onSubmit={handleSaveEstate}
          />
          <ArticleDialog
            article={editingArticle}
            saving={saving}
            onChange={setEditingArticle}
            onClose={() => setEditingArticle(null)}
            onSubmit={handleSaveArticle}
          />
          <FaqDialog
            faq={editingFaq}
            saving={saving}
            onChange={setEditingFaq}
            onClose={() => setEditingFaq(null)}
            onSubmit={handleSaveFaq}
          />
          <MediaDialog
            media={editingMedia}
            saving={saving}
            onChange={setEditingMedia}
            onClose={() => setEditingMedia(null)}
            onSubmit={handleSaveMedia}
          />
        </>
      ) : null}
    </AdminShell>
  );
}

function EstateDialog({
  estate,
  saving,
  onChange,
  onClose,
  onSubmit,
}: {
  estate: AdminEstateInput | null;
  saving: boolean;
  onChange: (estate: AdminEstateInput | null) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={!!estate} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{estate?.id ? "編輯屋苑 SEO" : "新增屋苑 SEO"}</DialogTitle>
          <DialogDescription>完整欄位會一併儲存，避免覆寫未載入資料。</DialogDescription>
        </DialogHeader>
        {estate ? (
          <form className="grid gap-4" onSubmit={onSubmit}>
            <div className="grid gap-4 md:grid-cols-3">
              <TextField
                label="Slug"
                value={estate.slug}
                onChange={(value) => onChange({ ...estate, slug: value })}
                required
              />
              <TextField
                label="中文名"
                value={estate.name_zh}
                onChange={(value) => onChange({ ...estate, name_zh: value })}
                required
              />
              <TextField
                label="英文名"
                value={estate.name_en ?? ""}
                onChange={(value) => onChange({ ...estate, name_en: nullIfBlank(value) })}
              />
              <TextField
                label="地區"
                value={estate.district_slug}
                onChange={(value) => onChange({ ...estate, district_slug: value })}
                required
              />
              <TextField
                label="發展商"
                value={estate.developer ?? ""}
                onChange={(value) => onChange({ ...estate, developer: nullIfBlank(value) })}
              />
              <TextField
                label="Hero 圖片"
                value={estate.hero_image ?? ""}
                onChange={(value) => onChange({ ...estate, hero_image: nullIfBlank(value) })}
              />
              <NumberField
                label="落成年份"
                value={estate.year_completed}
                onChange={(value) => onChange({ ...estate, year_completed: value })}
              />
              <NumberField
                label="期數"
                value={estate.phases}
                onChange={(value) => onChange({ ...estate, phases: value })}
              />
              <NumberField
                label="伙數"
                value={estate.total_units}
                onChange={(value) => onChange({ ...estate, total_units: value })}
              />
              <NumberField
                label="面積下限"
                value={estate.area_min}
                onChange={(value) => onChange({ ...estate, area_min: value })}
              />
              <NumberField
                label="面積上限"
                value={estate.area_max}
                onChange={(value) => onChange({ ...estate, area_max: value })}
              />
            </div>
            <TextAreaField
              label="設施"
              value={estate.facilities.join("\n")}
              onChange={(value) => onChange({ ...estate, facilities: splitList(value) })}
              rows={4}
            />
            <TextAreaField
              label="描述"
              value={estate.description ?? ""}
              onChange={(value) => onChange({ ...estate, description: nullIfBlank(value) })}
              rows={5}
            />
            <TextField
              label="SEO 標題"
              value={estate.seo_title ?? ""}
              onChange={(value) => onChange({ ...estate, seo_title: nullIfBlank(value) })}
            />
            <TextAreaField
              label="SEO 描述"
              value={estate.seo_description ?? ""}
              onChange={(value) => onChange({ ...estate, seo_description: nullIfBlank(value) })}
              rows={3}
            />
            <EditorFooter saving={saving} onClose={onClose} />
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ArticleDialog({
  article,
  saving,
  onChange,
  onClose,
  onSubmit,
}: {
  article: AdminArticleInput | null;
  saving: boolean;
  onChange: (article: AdminArticleInput | null) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={!!article} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{article?.id ? "文章編輯" : "新增文章"}</DialogTitle>
          <DialogDescription>內容、發布狀態及 SEO 欄位會一併儲存。</DialogDescription>
        </DialogHeader>
        {article ? (
          <form className="grid gap-4" onSubmit={onSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                label="Slug"
                value={article.slug}
                onChange={(value) => onChange({ ...article, slug: value })}
                required
              />
              <TextField
                label="標題"
                value={article.title}
                onChange={(value) => onChange({ ...article, title: value })}
                required
              />
              <TextField
                label="分類"
                value={article.category ?? ""}
                onChange={(value) => onChange({ ...article, category: nullIfBlank(value) })}
              />
              <NumberField
                label="閱讀分鐘"
                value={article.reading_minutes}
                onChange={(value) => onChange({ ...article, reading_minutes: value })}
              />
              <TextField
                label="封面圖片"
                value={article.cover_image ?? ""}
                onChange={(value) => onChange({ ...article, cover_image: nullIfBlank(value) })}
              />
              <TextField
                label="發布時間"
                value={article.published_at ?? ""}
                onChange={(value) => onChange({ ...article, published_at: nullIfBlank(value) })}
              />
            </div>
            <Field label="發布">
              <div className="flex min-h-11 items-center gap-3 rounded-md border px-3">
                <Switch
                  checked={article.published}
                  onCheckedChange={(checked) => onChange({ ...article, published: checked })}
                  aria-label="切換文章發布狀態"
                />
                <span className="text-sm text-muted-foreground">
                  {article.published ? "已發布" : "草稿"}
                </span>
              </div>
            </Field>
            <TextAreaField
              label="摘要"
              value={article.excerpt ?? ""}
              onChange={(value) => onChange({ ...article, excerpt: nullIfBlank(value) })}
              rows={3}
            />
            <TextAreaField
              label="內容"
              value={article.content ?? ""}
              onChange={(value) => onChange({ ...article, content: nullIfBlank(value) })}
              rows={8}
            />
            <TextField
              label="SEO 標題"
              value={article.seo_title ?? ""}
              onChange={(value) => onChange({ ...article, seo_title: nullIfBlank(value) })}
            />
            <TextAreaField
              label="SEO 描述"
              value={article.seo_description ?? ""}
              onChange={(value) => onChange({ ...article, seo_description: nullIfBlank(value) })}
              rows={3}
            />
            <EditorFooter saving={saving} onClose={onClose} />
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FaqDialog({
  faq,
  saving,
  onChange,
  onClose,
  onSubmit,
}: {
  faq: AdminFaqInput | null;
  saving: boolean;
  onChange: (faq: AdminFaqInput | null) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={!!faq} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{faq?.id ? "FAQ 編輯" : "新增 FAQ"}</DialogTitle>
          <DialogDescription>FAQ 會按 scope 分組並依排序值顯示。</DialogDescription>
        </DialogHeader>
        {faq ? (
          <form className="grid gap-4" onSubmit={onSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                label="Scope"
                value={faq.scope}
                onChange={(value) => onChange({ ...faq, scope: value })}
                required
              />
              <NumberField
                label="排序"
                value={faq.sort_order}
                onChange={(value) => onChange({ ...faq, sort_order: value ?? 0 })}
              />
            </div>
            <TextField
              label="問題"
              value={faq.question}
              onChange={(value) => onChange({ ...faq, question: value })}
              required
            />
            <TextAreaField
              label="答案"
              value={faq.answer}
              onChange={(value) => onChange({ ...faq, answer: value })}
              rows={6}
              required
            />
            <EditorFooter saving={saving} onClose={onClose} />
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MediaDialog({
  media,
  saving,
  onChange,
  onClose,
  onSubmit,
}: {
  media: EditingMediaAsset | null;
  saving: boolean;
  onChange: (media: EditingMediaAsset | null) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={!!media} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>媒體庫</DialogTitle>
          <DialogDescription>{media?.pathname ?? "更新媒體資料"}</DialogDescription>
        </DialogHeader>
        {media ? (
          <form className="grid gap-4" onSubmit={onSubmit}>
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <a
                href={media.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium hover:underline"
              >
                {media.url}
              </a>
              <p className="mt-1 text-xs text-muted-foreground">
                {media.owner_type}
                {media.owner_id ? ` · ${media.owner_id}` : ""}
              </p>
            </div>
            <TextAreaField
              label="替代文字"
              value={media.alt_text ?? ""}
              onChange={(value) => onChange({ ...media, alt_text: value })}
              rows={4}
            />
            <EditorFooter saving={saving} onClose={onClose} />
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EditorFooter({ saving, onClose }: { saving: boolean; onClose: () => void }) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
        取消
      </Button>
      <Button type="submit" disabled={saving}>
        <Save className="h-4 w-4" />
        {saving ? "儲存中…" : "儲存"}
      </Button>
    </DialogFooter>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <Field label={label}>
      <Input value={value} onChange={(event) => onChange(event.target.value)} required={required} />
    </Field>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        value={value ?? ""}
        onChange={(event) => onChange(parseNullableNumber(event.target.value))}
      />
    </Field>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  rows,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  required?: boolean;
}) {
  return (
    <Field label={label}>
      <Textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
    </Field>
  );
}

function estateToInput(estate: AdminEstateCmsRow): AdminEstateInput {
  return {
    id: estate.id,
    slug: estate.slug,
    name_zh: estate.name_zh,
    name_en: estate.name_en,
    district_slug: estate.district_slug,
    developer: estate.developer,
    year_completed: estate.year_completed,
    phases: estate.phases,
    total_units: estate.total_units,
    area_min: estate.area_min,
    area_max: estate.area_max,
    description: estate.description,
    hero_image: estate.hero_image,
    facilities: estate.facilities,
    seo_title: estate.seo_title,
    seo_description: estate.seo_description,
  };
}

function articleToInput(article: AdminArticleCmsRow): AdminArticleInput {
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    excerpt: article.excerpt,
    content: article.content,
    cover_image: article.cover_image,
    category: article.category,
    reading_minutes: article.reading_minutes,
    published: article.published,
    published_at: article.published_at,
    seo_title: article.seo_title,
    seo_description: article.seo_description,
  };
}

function faqToInput(faq: AdminFaqCmsRow): AdminFaqInput {
  return {
    id: faq.id,
    scope: faq.scope,
    question: faq.question,
    answer: faq.answer,
    sort_order: faq.sort_order,
  };
}

function mediaToInput(asset: AdminMediaAssetRow): EditingMediaAsset {
  return {
    id: asset.id,
    url: asset.url,
    pathname: asset.pathname,
    alt_text: asset.alt_text,
    owner_type: asset.owner_type,
    owner_id: asset.owner_id,
  };
}

function nullIfBlank(value: string) {
  const text = value.trim();
  return text ? text : null;
}

function splitList(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNullableNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatBytes(value: number | null) {
  if (!value) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function assertNoServerError(result: unknown) {
  if (!result || typeof result !== "object" || !("error" in result)) return;
  const error = (result as { error?: unknown }).error;
  if (typeof error === "string" && error) throw new Error(error);
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "操作失敗，請稍後再試";
}
