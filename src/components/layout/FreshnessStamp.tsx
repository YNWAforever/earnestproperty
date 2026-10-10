import * as React from "react";

import { freshnessLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { DataAttributes } from "./types";

export interface FreshnessStampProps extends React.HTMLAttributes<HTMLSpanElement>, DataAttributes {
  updatedAt: string | number | Date | null | undefined;
}

const FreshnessStamp = React.forwardRef<HTMLSpanElement, FreshnessStampProps>(
  ({ className, updatedAt, ...props }, ref) => {
    // CDN-cached HTML can be minutes old, so the server render (and the
    // hydration pass) shows the clock-independent date; the relative label
    // is computed from the visitor's clock after mount.
    const [now, setNow] = React.useState<Date | null>(null);
    React.useEffect(() => {
      setNow(new Date());
    }, []);
    const label = freshnessLabel(updatedAt, now);
    if (!label) return null;
    return (
      <span ref={ref} className={cn("text-xs text-muted-foreground", className)} {...props}>
        {label}
      </span>
    );
  },
);
FreshnessStamp.displayName = "FreshnessStamp";

export { FreshnessStamp };
