import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import type { DataAttributes } from "./types";

const sectionVariants = cva("py-12 sm:py-14", {
  variants: {
    tone: {
      plain: "",
      muted: "border-b bg-muted/30",
      card: "border-y border-border bg-card",
    },
  },
  defaultVariants: {
    tone: "plain",
  },
});

export interface SectionProps
  extends
    React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof sectionVariants>,
    DataAttributes {}

const Section = React.forwardRef<HTMLElement, SectionProps>(
  ({ className, tone, ...props }, ref) => (
    <section
      ref={ref}
      className={cn(sectionVariants({ tone }), className)}
      {...props}
    />
  ),
);
Section.displayName = "Section";

export { Section, sectionVariants };
