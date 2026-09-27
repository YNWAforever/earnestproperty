export function responsiveSrcSet(set) {
  if (set?.status !== "ready" || !Array.isArray(set.variants)) return undefined;
  const variants = set.variants
    .filter(
      (item) => Number.isInteger(item.width) && item.width > 0 && /^https:\/\//.test(item.url),
    )
    .sort((a, b) => a.width - b.width);
  return variants.length
    ? variants.map((item) => item.url + " " + item.width + "w").join(", ")
    : undefined;
}
