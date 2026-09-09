import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Building2, MessageCircle } from "lucide-react";

import { AppImage } from "@/components/media/AppImage";
import { EmptyState } from "@/components/layout/EmptyState";
import { Button } from "@/components/ui/button";
import { whatsappUrl } from "@/config/site";
import { CASTLE_PEAK_ROAD_OTHER_LABEL } from "@/content/castle-peak-road-estates";
import { CORE_ESTATES_PREVIEW_COUNT, estateFigure, type CoreEstate } from "@/content/core-estates";
import type { EstateSummary } from "@/lib/queries";

// Card placeholders until 屋苑相片 land. Hues sit in a ±13° band around the brand
// green (157°) so each estate stays distinguishable without drifting off-palette.
const ESTATE_GRADIENTS: Record<string, string> = {
  bellagio: "linear-gradient(135deg, oklch(0.62 0.1 159.5), oklch(0.4 0.09 156.5))",
  "sea-crest-villa": "linear-gradient(135deg, oklch(0.65 0.09 169.5), oklch(0.42 0.08 162.5))",
  "hong-kong-garden": "linear-gradient(135deg, oklch(0.68 0.08 144.5), oklch(0.44 0.07 152.5))",
  "rhine-garden": "linear-gradient(135deg, oklch(0.6 0.1 164.5), oklch(0.4 0.09 156.5))",
  "lido-garden": "linear-gradient(135deg, oklch(0.65 0.08 149.5), oklch(0.43 0.08 154.5))",
};

/**
 * One estate card. Extracted so the client's 其他 group (docx p2) renders its
 * revealed estates with exactly the same card as the primary tier rather than
 * a second, drifting copy of the markup.
 *
 * `dbRow` presence (not `estate.hasPage` alone) gates the link: hasPage means
 * the route/content/SEO plumbing exists, not that the estate is published, so
 * linking on hasPage alone would ship a link that 404s.
 */
function EstateCard({
  estate,
  dbRow,
  counts,
  districtLabel,
  hidden,
}: {
  estate: CoreEstate;
  dbRow: EstateSummary | undefined;
  counts: Record<string, number>;
  districtLabel: string;
  hidden?: boolean;
}) {
  const units = dbRow?.total_units ?? estate.units;
  const psf = dbRow?.avg_saleable_psf == null ? null : Number(dbRow.avg_saleable_psf);
  const photo = estate.photo ?? dbRow?.hero_image;
  const listingCount = dbRow ? (counts[estate.slug] ?? 0) : estate.listingCount;
  const meta = [estate.district, `${estateFigure(units)} 個單位`].filter(Boolean).join(" · ");

  const card = (
    <>
      <div
        className="relative h-48 overflow-hidden"
        style={
          photo
            ? undefined
            : { background: ESTATE_GRADIENTS[estate.slug] ?? ESTATE_GRADIENTS.bellagio }
        }
      >
        <AppImage
          src={photo}
          alt={`${estate.name} ${districtLabel} 放盤`}
          width={1600}
          height={900}
          loading="lazy"
          sizes="(min-width: 1280px) 296px, (min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
          className="h-full w-full object-cover"
          fallback={<></>}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <Building2 className="absolute right-4 top-4 h-8 w-8 text-primary-foreground/40" />
        <div className="absolute bottom-4 left-5 text-primary-foreground">
          <h3 className="text-2xl font-bold">{estate.name}</h3>
          <p className="text-xs opacity-80">{meta}</p>
        </div>
        {estate.photo && estate.photoCredit ? (
          <p className="absolute bottom-1 right-2 text-[9px] text-primary-foreground/60">
            {estate.photoCredit}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 p-5">
        <div>
          <p className="text-[11px] text-muted-foreground">平均放盤實呎</p>
          <p className="text-base font-semibold text-primary">
            {psf === null || psf === undefined || !Number.isFinite(psf)
              ? "—"
              : `$${estateFigure(psf)}`}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">最新放盤</p>
          <p className="text-base font-semibold text-primary">
            {listingCount === null || listingCount === undefined ? "—" : `${listingCount} 個`}
          </p>
        </div>
        {dbRow ? (
          <div className="col-span-2 mt-1 flex items-center justify-between border-t border-border pt-3 text-sm font-medium text-primary">
            <span>瀏覽屋苑詳情</span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </div>
        ) : null}
      </div>
    </>
  );

  const shell =
    "group relative overflow-hidden rounded-2xl border border-border bg-card shadow-card";

  return dbRow ? (
    <Link
      to="/estate/$slug"
      params={{ slug: estate.slug }}
      hidden={hidden}
      className={`${shell} transition-all hover:-translate-y-1 hover:shadow-elegant`}
    >
      {card}
    </Link>
  ) : (
    <div hidden={hidden} className={shell}>
      {card}
    </div>
  );
}

/**
 * The client's approved estate cards for one commercial area group, in the
 * client's own order (client-area-presentation.ts, docx p2/p3).
 *
 * Live figures are merged in by slug. A static entry with no live, published
 * row is filtered out entirely rather than shipped as a thin, non-clickable
 * card next to real ones.
 *
 * `otherEstates` renders the client's 其他 tile: a real <button> with
 * aria-expanded/aria-controls that reveals an inline secondary grid. 其他 is a
 * group control, never an estate -- it has no slug, no row, no figures and no
 * detail page, and is never counted among the primary cards.
 *
 * Exported only so estate-group-grid.test.tsx can render it against fixtures
 * and assert the client's ordering and the 其他 control's ARIA wiring on real
 * markup. TanStack Router's file-based routing reads this module's `Route`
 * export alone, so the extra export changes no routing behaviour.
 */
export function CoreEstateGrid({
  estates,
  counts,
  staticEstates,
  districtLabel,
  previewCount = CORE_ESTATES_PREVIEW_COUNT,
  otherEstates = [],
  otherLabel = CASTLE_PEAK_ROAD_OTHER_LABEL,
  otherId = "estate-group-other",
}: {
  estates: EstateSummary[];
  counts: Record<string, number>;
  staticEstates: CoreEstate[];
  districtLabel: string;
  /**
   * Cards rendered before the 查看更多屋苑 expander. Defaults to the shared
   * eight-card preview; the client's two amended groups pass their own full
   * length so the agreed sequence is never silently truncated. Scoped per
   * section on purpose -- preview behaviour elsewhere is unchanged.
   */
  previewCount?: number;
  otherEstates?: CoreEstate[];
  otherLabel?: string;
  /** DOM id of the revealed region, referenced by the tile's aria-controls. */
  otherId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const live = new Map(estates.map((estate) => [estate.slug, estate]));
  // hasPage:true means the route/content/SEO plumbing exists for this estate
  // (estate-registry.ts's own doc comment); it does NOT mean the estate is
  // actually published -- the 2026-09-01 17-estate expansion gave all 22
  // registry entries hasPage:true while 17 of them stay published=false in
  // Neon until a human clears each one individually. A card must only link
  // (or count toward the grid at all) once its live DB row actually exists
  // in `estates` -- gating on hasPage alone would ship a link to a page that
  // 404s.
  const linkable = (list: CoreEstate[]) =>
    list.filter((estate) => estate.hasPage && live.has(estate.slug));
  const linkableEstates = linkable(staticEstates);
  const linkableOther = linkable(otherEstates);
  // Every linkable estate is rendered (so each /estate/* link is in the served
  // HTML); the ones past the preview count carry `hidden` until 查看更多屋苑.
  const isCollapsed = (index: number) => !expanded && index >= previewCount;

  // Mirrors the already-established pattern for "this section has nothing
  // real to show yet" elsewhere in this codebase (estate-reviews.tsx's own
  // 屋苑文章 section, and this same file's 最新放盤 EmptyState above).
  if (linkableEstates.length === 0 && linkableOther.length === 0) {
    return (
      <EmptyState
        className="mt-10"
        icon={Building2}
        title={`暫未有${districtLabel}屋苑專頁`}
        description="屋苑專頁陸續上線，歡迎先直接 WhatsApp 我哋查詢最新放盤。"
        action={
          <a
            href={whatsappUrl(`你好，想查詢${districtLabel}屋苑放盤`)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline">
              <MessageCircle className="h-4 w-4" />
              WhatsApp 查詢
            </Button>
          </a>
        }
      />
    );
  }

  return (
    <>
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {linkableEstates.map((estate, index) => (
          <EstateCard
            key={estate.slug}
            estate={estate}
            dbRow={live.get(estate.slug)}
            counts={counts}
            districtLabel={districtLabel}
            hidden={isCollapsed(index)}
          />
        ))}
        {linkableOther.length > 0 ? (
          <button
            type="button"
            aria-expanded={otherOpen}
            aria-controls={otherId}
            onClick={() => setOtherOpen((open) => !open)}
            className="group flex min-h-[12rem] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/40 bg-card p-6 text-center shadow-card transition-all hover:-translate-y-1 hover:border-primary hover:shadow-elegant focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Building2 className="h-8 w-8 text-primary/50" aria-hidden="true" />
            <span className="text-2xl font-bold text-primary">{otherLabel}</span>
            <span className="text-xs text-muted-foreground">
              {otherOpen ? "收起" : `另有 ${linkableOther.length} 個屋苑`}
            </span>
          </button>
        ) : null}
      </div>

      {linkableOther.length > 0 ? (
        <div id={otherId} hidden={!otherOpen} className="mt-6">
          <h3 className="text-sm font-semibold text-primary">
            {otherLabel}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {linkableOther.length} 個屋苑
            </span>
          </h3>
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {linkableOther.map((estate) => (
              <EstateCard
                key={estate.slug}
                estate={estate}
                dbRow={live.get(estate.slug)}
                counts={counts}
                districtLabel={districtLabel}
              />
            ))}
          </div>
        </div>
      ) : null}

      {linkableEstates.length > previewCount && !expanded ? (
        <div className="mt-8 flex justify-center">
          <Button variant="outline" onClick={() => setExpanded(true)}>
            查看更多屋苑
          </Button>
        </div>
      ) : null}
    </>
  );
}
