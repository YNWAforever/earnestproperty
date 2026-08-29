import * as React from "react";

import { cn } from "@/lib/utils";

import type { DataAttributes } from "./types";

export interface EmptyStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title">, DataAttributes {
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className, icon: Icon, title, description, action, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-lg border bg-card p-8 text-center shadow-card",
        className,
      )}
      {...props}
    >
      {Icon ? <Icon className="mx-auto h-8 w-8 text-primary" /> : null}
      <h2 className="mt-4 text-xl font-semibold text-primary">{title}</h2>
      {description ? (
        <p className="mx-auto mt-2 max-w-xl text-sm leading-7 text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  ),
);
EmptyState.displayName = "EmptyState";

export { EmptyState };
