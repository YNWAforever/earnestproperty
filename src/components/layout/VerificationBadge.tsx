import * as React from "react";
import { CheckCircle2, HelpCircle } from "lucide-react";

import { cn } from "@/lib/utils";

import type { DataAttributes } from "./types";

export interface VerificationBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, DataAttributes {
  verified: boolean;
}

const VerificationBadge = React.forwardRef<
  HTMLSpanElement,
  VerificationBadgeProps
>(({ className, verified, ...props }, ref) => (
  <span
    ref={ref}
    className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
      verified
        ? "bg-accent text-accent-foreground"
        : "bg-muted text-muted-foreground",
      className,
    )}
    {...props}
  >
    {verified ? (
      <CheckCircle2 aria-hidden="true" className="h-3 w-3" />
    ) : (
      <HelpCircle aria-hidden="true" className="h-3 w-3" />
    )}
    {verified ? "已核實" : "待核實"}
  </span>
));
VerificationBadge.displayName = "VerificationBadge";

export { VerificationBadge };
