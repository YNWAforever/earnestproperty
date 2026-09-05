import * as React from "react";

import { cn } from "@/lib/utils";
import responsiveImages from "@/lib/media/responsive-images.generated.json";

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
      srcSet,
      sizes,
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

    const responsive = (responsiveImages as Record<string, { srcSet: string }>)[src];
    return (
      <img
        ref={ref}
        src={src}
        srcSet={srcSet ?? responsive?.srcSet}
        sizes={sizes ?? (responsive ? "100vw" : undefined)}
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
