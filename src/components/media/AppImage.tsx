import * as React from "react";

import { cn } from "@/lib/utils";

export interface AppImageProps extends Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  "src" | "alt" | "width" | "height" | "loading"
> {
  src: string | null | undefined;
  alt: string;
  width: number;
  height: number;
  loading?: "eager" | "lazy";
  fallback?: React.ReactNode;
}

const AppImage = React.forwardRef<HTMLImageElement, AppImageProps>(
  (
    {
      src,
      alt,
      width,
      height,
      loading = "lazy",
      decoding = "async",
      className,
      fallback,
      onError,
      ...props
    },
    ref,
  ) => {
    const [failed, setFailed] = React.useState(false);

    React.useEffect(() => {
      setFailed(false);
    }, [src]);

    if (!src || failed) {
      return (
        fallback ?? (
          <div
            className={cn(
              "flex items-center justify-center bg-muted text-sm text-muted-foreground",
              className,
            )}
          >
            晉誠地產
          </div>
        )
      );
    }

    return (
      <img
        ref={ref}
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={loading}
        decoding={decoding}
        className={cn("object-cover", className)}
        onError={(event) => {
          setFailed(true);
          onError?.(event);
        }}
        {...props}
      />
    );
  },
);
AppImage.displayName = "AppImage";

export { AppImage };
