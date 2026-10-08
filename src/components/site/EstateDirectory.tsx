import { useEffect, useState } from "react";
import { Search, ArrowRight } from "lucide-react";
import { SiteLink } from "@/components/site/SiteLink";
import { estatePath } from "@/lib/estate-links";
import { fetchNeonEstateDirectory } from "@/lib/neon/public-data";
import {
  groupEstateDirectory,
  estateListingHref,
  type EstateDirectoryData,
} from "@/lib/estate-directory";
import { clientAreaGroupsInNavOrder } from "@/content/client-area-presentation";

let cached: EstateDirectoryData | undefined;
let cachedAt = 0;
let pending: Promise<EstateDirectoryData> | undefined;
function loadDirectory() {
  if (cached && Date.now() - cachedAt < 60_000) return Promise.resolve(cached);
  if (!pending)
    pending = fetchNeonEstateDirectory()
      .then((data) => {
        cached = data;
        cachedAt = Date.now();
        return data;
      })
      .finally(() => {
        pending = undefined;
      });
  return pending;
}

export function EstateDirectory({
  mobile = false,
  onLinkClick,
}: {
  mobile?: boolean;
  onLinkClick: () => void;
}) {
  const [data, setData] = useState<EstateDirectoryData>();
  const [query, setQuery] = useState("");
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(false);
    loadDirectory()
      .then((value) => {
        if (alive) setData(value);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [attempt]);
  const groups = groupEstateDirectory(data?.rows ?? [], query);
  const rows = (estates: NonNullable<typeof data>["rows"]) =>
    estates.map((estate) => (
      <div key={estate.slug} className="flex min-h-12 items-center gap-2 border-b border-border/40">
        {/* No estate page link from an empty slug (FX-13 L-05: /estate/null). */}
        {estatePath(estate.slug) ? (
          <SiteLink
            href={`/estate/${encodeURIComponent(estate.slug)}`}
            onClick={onLinkClick}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded px-2 text-sm font-medium hover:bg-accent hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="truncate">{estate.nameZh}</span>
            <span className="text-xs font-normal tabular-nums text-muted-foreground">
              {estate.total}
            </span>
          </SiteLink>
        ) : (
          <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-2 text-sm font-medium">
            <span className="truncate">{estate.nameZh}</span>
            <span className="text-xs font-normal tabular-nums text-muted-foreground">
              {estate.total}
            </span>
          </div>
        )}
        {(["sale", "rent"] as const).map((deal) => (
          <SiteLink
            key={deal}
            href={estateListingHref(estate.slug, deal)}
            onClick={onLinkClick}
            aria-label={`${estate.nameZh}${deal === "sale" ? "出售" : "出租"} ${estate[deal]} 個放盤`}
            className="flex min-h-11 min-w-11 items-center justify-center rounded px-1 text-xs tabular-nums text-muted-foreground hover:bg-accent hover:text-primary"
          >
            {deal === "sale" ? "售" : "租"} {estate[deal]}
          </SiteLink>
        ))}
      </div>
    ));
  return (
    <div
      data-estate-directory
      className={mobile ? "mt-3" : "flex max-h-[calc(100dvh-6rem)] flex-col"}
    >
      <div
        className={
          mobile ? "space-y-3" : "flex shrink-0 items-center justify-between gap-6 border-b p-5"
        }
      >
        <div>
          <h2 className="text-lg font-semibold">分區屋苑總覽</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {data ? `${data.rows.length} 個屋苑 · 即時租售放盤` : "瀏覽各區屋苑與租售放盤"}
          </p>
        </div>
        <label className="flex items-center gap-2 rounded-md border bg-muted/30 px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            aria-label="搜尋屋苑"
            placeholder="搜尋中文／英文屋苑名稱"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 w-full min-w-0 bg-transparent text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </label>
      </div>
      <div className={mobile ? "py-3" : "min-h-0 overflow-y-auto px-5 py-4"}>
        <div className="mb-4 flex flex-wrap gap-2">
          {/* docx p1: the client's exact three shortcut labels, in their order.
              Both the label and the destination come from
              client-area-presentation.ts, which also names the group headings
              below -- so a shortcut and the section it leads to can never
              disagree, on desktop or mobile. */}
          {clientAreaGroupsInNavOrder().map(({ href, label }) => (
            <SiteLink
              key={href}
              href={href}
              onClick={onLinkClick}
              className="inline-flex min-h-11 items-center rounded-full bg-accent px-3 text-xs font-medium text-primary"
            >
              {label}
              <ArrowRight className="ml-1 h-3 w-3" />
            </SiteLink>
          ))}
        </div>
        {error ? (
          <div role="alert" className="py-6 text-sm">
            未能載入屋苑放盤數量。
            <button
              type="button"
              onClick={() => setAttempt((v) => v + 1)}
              className="ml-2 min-h-11 underline"
            >
              重試
            </button>
          </div>
        ) : !data ? (
          <div role="status" className="py-4 text-sm text-muted-foreground">
            <p>正在載入屋苑…</p>
            <div aria-hidden="true" className="mt-4 grid animate-pulse gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 rounded bg-muted" />
              ))}
            </div>
          </div>
        ) : groups.length === 0 ? (
          <p role="status" className="py-8 text-sm text-muted-foreground">
            {query ? "找不到相符屋苑，請嘗試其他名稱。" : "暫無已發佈屋苑。"}
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="ml-2 min-h-11 underline"
              >
                清除搜尋
              </button>
            )}
          </p>
        ) : (
          <div className={mobile ? "space-y-3" : "grid grid-cols-3 gap-x-6 gap-y-5"}>
            {groups.map((group) =>
              mobile ? (
                <details
                  key={`${group.label}-${Boolean(query)}`}
                  open={query ? true : undefined}
                  className="rounded-md border px-2"
                >
                  <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">
                    {group.label}{" "}
                    <span className="text-muted-foreground">({group.estates.length})</span>
                  </summary>
                  {rows(group.estates)}
                </details>
              ) : (
                <section
                  key={group.label}
                  className={group.estates.length > 10 ? "col-span-2" : ""}
                >
                  <h3 className="mb-2 border-b-2 border-primary/20 pb-2 text-sm font-semibold text-primary">
                    {group.label}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {group.estates.length} 個屋苑
                    </span>
                  </h3>
                  <div className={group.estates.length > 10 ? "grid grid-cols-2 gap-x-6" : ""}>
                    {rows(group.estates)}
                  </div>
                </section>
              ),
            )}
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-3 py-2 text-xs">
        <div className="flex flex-wrap gap-4">
          <SiteLink
            href="/listings"
            onClick={onLinkClick}
            className="inline-flex min-h-11 items-center font-semibold text-primary"
          >
            查看全部放盤 →
          </SiteLink>
          <SiteLink
            href="/estate-reviews"
            onClick={onLinkClick}
            className="inline-flex min-h-11 items-center"
          >
            屋苑評測 →
          </SiteLink>
        </div>
        {data && (
          <span className="text-muted-foreground">
            更新{" "}
            {new Date(data.generatedAt).toLocaleTimeString("zh-HK", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Asia/Hong_Kong",
            })}
          </span>
        )}
      </div>
    </div>
  );
}
