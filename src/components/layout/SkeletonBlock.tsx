import * as React from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { DataAttributes } from "./types";

export interface SkeletonBlockProps
  extends React.HTMLAttributes<HTMLDivElement>, DataAttributes {
  variant?: "lines" | "card";
  lines?: number;
}

const SkeletonBlock = React.forwardRef<HTMLDivElement, SkeletonBlockProps>(
  ({ className, variant = "lines", lines = 3, ...props }, ref) => {
    if (variant === "card") {
      return (
        <div
          ref={ref}
          className={cn("overflow-hidden rounded-lg border", className)}
          {...props}
        >
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
      );
    }

    return (
      <div ref={ref} className={cn("space-y-2", className)} {...props}>
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton
            key={i}
            className={cn("h-4", i === lines - 1 ? "w-2/3" : "w-full")}
          />
        ))}
      </div>
    );
  },
);
SkeletonBlock.displayName = "SkeletonBlock";

export { SkeletonBlock };
