import manifest from "./staging-images.generated.json";

export function createIsolatedImageResolver(
  origin: string | undefined,
  images: Readonly<Record<string, string>> = manifest.images,
  expectedOrigin: string = manifest.targetOrigin,
) {
  if (!origin) return (src: string) => src;
  if (origin !== expectedOrigin) throw new Error("ISOLATED_IMAGE_ORIGIN_MISMATCH");
  return (src: string) => {
    if (src.startsWith("/") && !src.startsWith("//") && !src.includes("\\")) return src;
    const resolved = Object.hasOwn(images, src) ? images[src] : src;
    const url = new URL(resolved);
    if (url.origin !== origin || url.username || url.password)
      throw new Error("ISOLATED_IMAGE_NOT_MAPPED");
    return resolved;
  };
}

export function resolveIsolatedSrcSet(
  srcSet: string | undefined,
  resolve: (src: string) => string,
) {
  return srcSet
    ?.split(",")
    .map((candidate) => {
      const [src, ...descriptor] = candidate.trim().split(/\s+/);
      return [resolve(src), ...descriptor].join(" ");
    })
    .join(", ");
}

const origin = import.meta.env?.VITE_ISOLATED_MEDIA_ORIGIN;
export const resolveImageSource = createIsolatedImageResolver(origin);
export const resolveImageSrcSet = (srcSet: string | undefined) =>
  origin ? resolveIsolatedSrcSet(srcSet, resolveImageSource) : srcSet;
