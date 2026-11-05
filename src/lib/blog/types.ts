import type { CmsEditState } from "../neon/admin-cms.types";
export type Scope = { kind: "main" } | { kind: "category"; categoryId: string };
export type PageCopy = {
  heading: string;
  introduction: string;
  seoTitle: string | null;
  seoDescription: string | null;
};
// Joined DTO: PageCopy comes exclusively from category-scoped blog_settings.
export type BlogCategory = PageCopy & {
  id: string;
  key: string;
  name: string;
  navigationOrder: number;
  hidden: boolean;
  /** Category metadata CAS version. */
  version: number;
  /** PageCopy/settings CAS version; combined edits must check both atomically. */
  settingsVersion: number;
};
export type ArticleSummary = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  categoryId: string | null;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  coverImage: string | null;
  coverAlt: string | null;
  author?: string | null;
  readingMinutes?: number;
};
export type BlogSettings = PageCopy & { scope: Scope; featuredIds: string[]; version: number };
export type ArticlePage = {
  items: ArticleSummary[];
  total: number;
  page: number;
  pageSize: number;
};
export type ArticleQuery = {
  search: string;
  categoryId?: string;
  state: "all" | "draft" | "published";
  page: number;
  pageSize: number;
};

/** Input boundary only. Never expose unknown documents in server-function return DTOs. */
export type ArticleBody =
  | { format: "legacy-text"; text: string }
  | { format: "editor-json-v1"; document: unknown };
export type EditorMark =
  | { type: "bold" | "italic" | "strike" | "underline" | "code" }
  | {
      type: "link";
      attrs: {
        href: string;
        target?: "_blank" | "_self" | null;
        rel?: string | null;
        title?: string | null;
        class?: null;
      };
    };
export type EditorNode =
  | { type: "doc" | "paragraph" | "blockquote" | "bulletList" | "listItem"; content?: EditorNode[] }
  | { type: "heading"; attrs: { level: 2 | 3 | 4 }; content?: EditorNode[] }
  | { type: "orderedList"; attrs?: { start?: number; type?: null }; content?: EditorNode[] }
  | { type: "text"; text: string; marks?: EditorMark[] }
  | { type: "hardBreak"; marks?: EditorMark[] }
  | { type: "horizontalRule" }
  | {
      type: "image";
      attrs: {
        src: string;
        alt?: string | null;
        title?: string | null;
        width?: number | null;
        height?: number | null;
      };
    };
export type EditorDocument = { type: "doc"; content: EditorNode[] };
export type ValidatedArticleBody =
  | { format: "legacy-text"; text: string }
  | { format: "editor-json-v1"; document: EditorDocument };
export type SupplementalLink = { href: string; label: string };
export type ArticleEditorialMetadata = {
  author: string | null;
  reviewer: string | null;
  sourcesNote: string | null;
  answerSummary: string | null;
  /** Live references, never a snapshot of changeable estate facts. */
  compareEstateSlugs: string[];
};
export type ArticleRecord = ArticleSummary & {
  body: ValidatedArticleBody;
  links: SupplementalLink[];
  editorial: ArticleEditorialMetadata;
  readingMinutes: number;
  seoTitle: string | null;
  seoDescription: string | null;
  version: number;
  slugLocked: boolean;
  editState: ArticleEditState;
};
/** Import candidate only: category resolution, identity and publication policy belong to the importer. */
export type RegistryArticleContent = {
  slug: string;
  title: string;
  excerpt: string;
  categoryKey: string;
  readingMinutes: number;
  publishedAt: string | null;
  body: ValidatedArticleBody;
  links: SupplementalLink[];
  editorial: ArticleEditorialMetadata;
};

/** Existing CMS tokens, unchanged; version alone is never a draft CAS token. */
export type ArticleEditState = Omit<CmsEditState<never>, "payload">;
export type ArticleInput = Omit<
  ArticleRecord,
  "id" | "version" | "slugLocked" | "createdAt" | "editState"
>;
export type SaveArticleCommand = {
  id?: string;
  expectedVersion?: number;
  editState?: ArticleEditState;
  input: ArticleInput;
  action: "save" | "publish" | "unpublish" | "reconcile";
  requestId: string;
};

/** Read-only options for authenticated draft authors; no settings or CAS tokens. */
export type BlogCategoryOption = Pick<BlogCategory, "id" | "key" | "name" | "hidden">;
