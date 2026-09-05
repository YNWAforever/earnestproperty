import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
const root = process.cwd();
const sources = [{ file: "src/assets/hero-front.jpg", key: "/hero-front.jpg" }];
for (const directory of ["estates", "branches"]) {
  for (const name of (await readdir(path.join(root, "public", directory))).sort()) {
    if (/\.(jpe?g|png|webp)$/i.test(name))
      sources.push({ file: `public/${directory}/${name}`, key: `/${directory}/${name}` });
  }
}
await mkdir(path.join(root, "public/responsive"), { recursive: true });
const manifest = {},
  metrics = [];
for (const source of sources) {
  const input = await readFile(path.join(root, source.file));
  const metadata = await sharp(input).metadata();
  if (!metadata.width || !metadata.height) throw Error(`Missing dimensions: ${source.file}`);
  // EXIF orientation can swap axes; descriptors must describe the oriented output.
  const swapped =
    metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8;
  const sourceWidth = swapped ? metadata.height : metadata.width;
  const sourceHeight = swapped ? metadata.width : metadata.height;
  const hash = createHash("sha256").update(input).digest("hex").slice(0, 10);
  const base = source.key
    .replace(/^\//, "")
    .replace(/\.[^.]+$/, "")
    .replaceAll("/", "-");
  const widths = [
    ...new Set(
      [320, 640, 960, 1440, 1920]
        .filter((w) => w < sourceWidth)
        .concat(Math.min(sourceWidth, 1920)),
    ),
  ];
  const variants = [];
  for (const width of widths) {
    const url = `/responsive/${base}-${hash}-${width}.webp`;
    const output = path.join(root, "public", url);
    await sharp(input)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 78, effort: 5 })
      .toFile(output);
    variants.push({ src: url, width, bytes: (await stat(output)).size });
  }
  manifest[source.key] = {
    width: sourceWidth,
    height: sourceHeight,
    srcSet: variants.map((v) => `${v.src} ${v.width}w`).join(", "),
  };
  metrics.push({ source: source.key, originalBytes: input.length, variants });
}
await writeFile(
  path.join(root, "src/lib/media/responsive-images.generated.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
const originalBytes = metrics.reduce((n, m) => n + m.originalBytes, 0);
const selected960Bytes = metrics.reduce(
  (n, m) => n + (m.variants.find((v) => v.width >= 960) ?? m.variants.at(-1)).bytes,
  0,
);
await writeFile(
  path.join(root, "docs/audits/astra-task-8-image-metrics.json"),
  JSON.stringify(
    {
      method:
        "Authorized source inventory; WebP quality78, no upscaling; 960px width proxy, not browser transfer",
      originalBytes,
      selected960Bytes,
      reduction: 1 - selected960Bytes / originalBytes,
      images: metrics,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    images: metrics.length,
    originalBytes,
    selected960Bytes,
    reduction: 1 - selected960Bytes / originalBytes,
  }),
);
