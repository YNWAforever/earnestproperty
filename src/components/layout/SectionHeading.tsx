import * as React from "react";

import { cn } from "@/lib/utils";

import type { DataAttributes } from "./types";

export interface SectionHeadingProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title">, DataAttributes {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  as?: "h2" | "h3";
  action?: React.ReactNode;
}

const SectionHeading = React.forwardRef<HTMLDivElement, SectionHeadingProps>(
  (
    { className, eyebrow, title, as: Heading = "h2", action, ...props },
    ref,
  ) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-wrap items-end justify-between gap-4",
        className,
      )}
      {...props}
    >
      <div>
        {eyebrow ? (
          <p className="text-sm font-semibold text-primary">{eyebrow}</p>
        ) : null}
        <Heading className="mt-1 text-2xl font-bold tracking-tight text-primary sm:text-3xl">
          {title}
        </Heading>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  ),
);
SectionHeading.displayName = "SectionHeading";

export { SectionHeading };
