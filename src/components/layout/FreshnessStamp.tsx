import * as React from "react";

import { formatFreshness } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { DataAttributes } from "./types";

export interface FreshnessStampProps
  extends React.HTMLAttributes<HTMLSpanElement>, DataAttributes {
  updatedAt: string | number | Date | null | undefined;
}

const FreshnessStamp = React.forwardRef<HTMLSpanElement, FreshnessStampProps>(
  ({ className, updatedAt, ...props }, ref) => {
    const label = formatFreshness(updatedAt);
    if (!label) return null;
    return (
      <span
        ref={ref}
        className={cn("text-xs text-muted-foreground", className)}
        {...props}
      >
        {label}
      </span>
    );
  },
);
FreshnessStamp.displayName = "FreshnessStamp";

export { FreshnessStamp };
