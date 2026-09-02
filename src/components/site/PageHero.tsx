import type { ReactNode } from "react";

import { Container } from "@/components/layout/Container";
import { cn } from "@/lib/utils";

/**
 * The one hero band every public inner page opens with, so pages line up:
 * same band, same container (max-w-7xl + responsive gutters), same eyebrow →
 * h1 → lead → actions rhythm. Before this, pages hand-rolled five container
 * widths and three hero styles, and two (/contact, /district/sham-tseng) had
 * no band at all.
 *
 * - `tone="brand"` keeps the estate page's gradient identity on the same
 *   structure.
 * - `size="compact"` is for tool pages (/listings) where the results, not the
 *   title, are the point.
 */
export function PageHero({
  eyebrow,
  title,
  lead,
  breadcrumb,
  actions,
  children,
  tone = "muted",
  size = "default",
  className,
  titleClassName,
  id,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  /** Rendered above the eyebrow -- pass a <Breadcrumbs/> for deep pages. */
  breadcrumb?: ReactNode;
  /** Buttons/links rendered below the lead. */
  actions?: ReactNode;
  /** Anything else that belongs in the band (stat strips, search boxes). */
  children?: ReactNode;
  tone?: "muted" | "brand";
  size?: "default" | "compact";
  className?: string;
  titleClassName?: string;
  id?: string;
}) {
  const brand = tone === "brand";
  return (
    <section
      id={id}
      data-page-hero
      className={cn(
        brand
          ? "bg-gradient-to-br from-primary to-primary/70 text-primary-foreground"
          : "border-b bg-muted/30",
        className,
      )}
    >
      <Container className={size === "compact" ? "py-8" : "py-14"}>
        {breadcrumb}
        {eyebrow ? (
          <p
            className={cn(
              "text-sm font-semibold",
              brand ? "opacity-80" : "text-primary",
              breadcrumb ? "mt-5" : "",
            )}
          >
            {eyebrow}
          </p>
        ) : null}
        <h1
          className={cn(
            "text-3xl font-bold tracking-tight",
            brand ? "" : "text-primary",
            size === "compact" ? "sm:text-4xl" : "sm:text-5xl",
            eyebrow ? "mt-3" : breadcrumb ? "mt-5" : "",
            titleClassName,
          )}
        >
          {title}
        </h1>
        {lead ? (
          <p
            className={cn(
              "max-w-3xl text-base leading-8",
              size === "compact" ? "mt-3" : "mt-5",
              brand ? "opacity-90" : "text-muted-foreground",
            )}
          >
            {lead}
          </p>
        ) : null}
        {actions ? <div className="mt-6 flex flex-wrap gap-3">{actions}</div> : null}
        {children}
      </Container>
    </section>
  );
}
