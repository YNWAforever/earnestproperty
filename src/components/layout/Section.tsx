import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

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

// See Container.tsx for why the `data-${string}` index signature is needed:
// it lets `React.createElement` calls pass `data-*` attributes (as the
// layout tests do) without tripping tsc's excess-property check.
export interface SectionProps
  extends
    React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof sectionVariants> {
  [key: `data-${string}`]: string | number | boolean | undefined;
}

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
