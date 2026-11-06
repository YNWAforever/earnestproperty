import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getFeaturedArticle, listFeaturedArticles } from "@/lib/neon/blog-admin";
import type { ArticlePage, Scope } from "@/lib/blog/types";
import { articleError, eligibleFeature } from "./blog-editor-state";
export function FeaturedArticlesEditor({
  scope,
  value,
  onChange,
}: {
  scope: Scope;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ArticlePage | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [titleErrors, setTitleErrors] = useState<Record<string, boolean>>({});
  const [titleRetry, setTitleRetry] = useState(0);
  // Selection hydration is independent of picker search, pagination and eligibility.
  const selectedIds = [...value].sort().join(",");
  useEffect(() => {
    let active = true;
    setTitleErrors({});
    for (const id of selectedIds ? selectedIds.split(",") : []) {
      void getFeaturedArticle({ data: { id } })
        .then((article) => {
          if (active) setTitles((previous) => ({ ...previous, [id]: article.title }));
        })
        .catch(() => {
          if (active) setTitleErrors((previous) => ({ ...previous, [id]: true }));
        });
    }
    return () => {
      active = false;
    };
  }, [selectedIds, titleRetry]);
  const categoryId = scope.kind === "category" ? scope.categoryId : undefined;
  useEffect(() => {
    let active = true;
    setError("");
    setResult(null);
    listFeaturedArticles({ data: { search, state: "published", categoryId, page, pageSize: 25 } })
      .then((data) => {
        if (active) {
          setResult(data);
          setTitles((t) => ({
            ...t,
            ...Object.fromEntries(data.items.map((a) => [a.id, a.title])),
          }));
        }
      })
      .catch((e) => {
        if (active) setError(articleError(e));
      });
    return () => {
      active = false;
    };
  }, [search, page, categoryId, retry]);
  function move(index: number, delta: number) {
    const ids = [...value];
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    onChange(ids);
  }
  return (
    <fieldset className="grid gap-3 rounded border p-3">
      <legend>精選文章（獨立排序）</legend>
      <ol className="grid gap-2">
        {value.map((id, i) => (
          <li key={id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-all">
              {i + 1}.{" "}
              {titles[id] ??
                (titleErrors[id]
                  ? `未能載入第 ${i + 1} 篇文章標題`
                  : `載入第 ${i + 1} 篇文章標題…`)}
            </span>
            {!titles[id] && titleErrors[id] ? (
              <Button
                type="button"
                aria-label={`重試第 ${i + 1} 篇標題`}
                onClick={() => setTitleRetry((n) => n + 1)}
              >
                重試標題
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={i === 0}
              aria-label={`上移第 ${i + 1} 篇`}
              onClick={() => move(i, -1)}
            >
              上移
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={i === value.length - 1}
              aria-label={`下移第 ${i + 1} 篇`}
              onClick={() => move(i, 1)}
            >
              下移
            </Button>
            <Button
              type="button"
              variant="outline"
              aria-label={`移除第 ${i + 1} 篇`}
              onClick={() => onChange(value.filter((x) => x !== id))}
            >
              移除
            </Button>
          </li>
        ))}
      </ol>
      <label>
        搜尋可用精選文章
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </label>
      {error ? (
        <div role="alert">
          {error}
          <Button type="button" onClick={() => setRetry((n) => n + 1)}>
            重試精選清單
          </Button>
        </div>
      ) : !result ? (
        <p role="status">載入精選選項…</p>
      ) : (
        <>
          <p>
            共 {result.total} 篇 · 第 {page} 頁
          </p>
          <ul>
            {result.items.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 py-1">
                <span>
                  {a.title}
                  {!eligibleFeature(a, scope) ? "（不可選取）" : ""}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    !eligibleFeature(a, scope) || value.includes(a.id) || value.length >= 100
                  }
                  onClick={() => {
                    if (eligibleFeature(a, scope) && !value.includes(a.id))
                      onChange([...value, a.id]);
                  }}
                >
                  加入
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              上一頁精選
            </Button>
            <Button
              type="button"
              disabled={page * 25 >= result.total}
              onClick={() => setPage((p) => p + 1)}
            >
              下一頁精選
            </Button>
          </div>
        </>
      )}
    </fieldset>
  );
}
