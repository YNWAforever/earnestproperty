import * as React from "react";

import { cn } from "@/lib/utils";

// The `data-${string}` index signature lets callers (tests, analytics hooks)
// pass arbitrary `data-*` attributes through `React.createElement` -- JSX
// already allows this on intrinsic elements, but `React.HTMLAttributes`
// alone doesn't, so plain `createElement({ "data-testid": ... })` calls fail
// tsc's excess-property check without it.
type ContainerProps = React.HTMLAttributes<HTMLDivElement> & {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

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
