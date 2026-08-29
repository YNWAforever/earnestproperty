import * as React from "react";

import { cn } from "@/lib/utils";
import type { DataAttributes } from "./types";

type ContainerProps = React.HTMLAttributes<HTMLDivElement> & DataAttributes;

const Container = React.forwardRef<HTMLDivElement, ContainerProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("mx-auto max-w-7xl px-4 sm:px-6 lg:px-8", className)}
      {...props}
    />
  ),
);
Container.displayName = "Container";

export { Container };
