import { SiteLink } from "@/components/site/SiteLink";
import { cn } from "@/lib/utils";

export type BreadcrumbItem = {
  label: string;
  /** Omit on the current page (the last item), which renders as plain text. */
  href?: string;
};

/**
 * Visible breadcrumb trail for pages three or more levels deep. Several pages
 * already emitted a BreadcrumbList in JSON-LD with no visible trail; Google's
 * own guidance expects the markup to describe something the visitor can see,
 * and a deep page without one leaves the visitor with no way up but the menu.
 */
export function Breadcrumbs({
  items,
  className,
  tone = "default",
}: {
  items: BreadcrumbItem[];
  className?: string;
  tone?: "default" | "inverse";
}) {
  const inverse = tone === "inverse";
  return (
    <nav
      aria-label="頁面路徑"
      className={cn(
        "text-sm",
        inverse ? "text-primary-foreground/80" : "text-muted-foreground",
        className,
      )}
    >
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${index}-${item.label}`} className="flex items-center gap-x-2">
              {index > 0 ? <span aria-hidden="true">›</span> : null}
              {item.href && !last ? (
                <SiteLink
                  href={item.href}
                  className={cn(
                    "hover:underline",
                    inverse ? "hover:text-primary-foreground" : "hover:text-primary",
                  )}
                >
                  {item.label}
                </SiteLink>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  className={cn(
                    last ? "font-medium" : "",
                    last ? (inverse ? "text-primary-foreground" : "text-foreground") : "",
                  )}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
