import * as React from "react";

import { cn } from "@/lib/utils";

import type { DataAttributes } from "./types";

type ProseProps = React.HTMLAttributes<HTMLDivElement> & DataAttributes;

const Prose = React.forwardRef<HTMLDivElement, ProseProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "max-w-none text-base leading-8 text-foreground",
        "[&>h2]:mt-8 [&>h2]:text-xl [&>h2]:font-bold [&>h2]:tracking-tight [&>h2]:text-primary",
        "[&>h3]:mt-6 [&>h3]:text-lg [&>h3]:font-semibold [&>h3]:text-primary",
        "[&>p]:mt-4 [&>ul]:mt-4 [&>ul]:list-disc [&>ul]:pl-6 [&>a]:text-primary [&>a]:underline",
        className,
      )}
      {...props}
    />
  ),
);
Prose.displayName = "Prose";

export { Prose };
