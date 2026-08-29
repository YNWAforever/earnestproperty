import * as React from "react";

import { cn } from "@/lib/utils";

import type { DataAttributes } from "./types";

export interface StatProps
  extends React.HTMLAttributes<HTMLDivElement>, DataAttributes {
  label: React.ReactNode;
  value: React.ReactNode;
}

const Stat = React.forwardRef<HTMLDivElement, StatProps>(
  ({ className, label, value, ...props }, ref) => (
    <div ref={ref} className={cn("text-center", className)} {...props}>
      <p className="text-3xl font-bold tabular-nums text-primary">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  ),
);
Stat.displayName = "Stat";

export { Stat };
