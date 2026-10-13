import type { ReactNode } from "react";

/** Header and body share the Shell's single width and gutter owner. */
export function AdminPageHeader({
  title,
  description,
  breadcrumb,
  actions,
  navigation,
}: {
  title: string;
  description: string;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
  navigation?: ReactNode;
}) {
  return (
    <header data-admin-header className="mb-6 flex min-w-0 flex-wrap items-start gap-4">
      <div className="min-w-0 flex-1 basis-full sm:basis-80">
        {breadcrumb ? (
          <div className="mb-2 break-words text-xs text-muted-foreground">{breadcrumb}</div>
        ) : null}
        <div className="flex min-w-0 items-start gap-2">
          {navigation}
          <h1 className="min-w-0 break-words text-2xl font-semibold leading-snug tracking-normal">
            {title}
          </h1>
        </div>
        <p className="mt-2 break-words text-sm text-muted-foreground">{description}</p>
      </div>
      {actions ? (
        <div
          data-admin-header-actions
          className="flex min-w-0 max-w-full flex-wrap gap-2 [&>*]:h-auto [&>*]:min-h-[44px] [&>*]:max-w-full [&>*]:whitespace-normal [&>*]:py-2"
        >
          {actions}
        </div>
      ) : null}
    </header>
  );
}
