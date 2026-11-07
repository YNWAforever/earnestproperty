import { expect, test } from "bun:test";
import { createIsolatedImageResolver, resolveIsolatedSrcSet } from "./isolated-images";

const origin = "https://isolated.public.blob.vercel-storage.com";
const original = "https://production.example/image.jpg";
const copy = origin + "/copied.jpg";
const images = { [original]: copy };

test("normal rendering preserves original image URLs and local paths", () => {
  const resolve = createIsolatedImageResolver(undefined, images, origin);
  expect(resolve(original)).toBe(original);
  expect(resolve("/photo.jpg")).toBe("/photo.jpg");
});
test("isolated rendering uses only exact copies, local files or its own store", () => {
  const resolve = createIsolatedImageResolver(origin, images, origin);
  expect(resolve(original)).toBe(copy);
  expect(resolve("/photo.jpg")).toBe("/photo.jpg");
  expect(resolve(origin + "/new-upload.png")).toBe(origin + "/new-upload.png");
  expect(resolveIsolatedSrcSet(`${original} 640w, /local.webp 1280w`, resolve)).toBe(
    `${copy} 640w, /local.webp 1280w`,
  );
});
test("unknown origins, invalid destinations and protocol-relative images fail closed", () => {
  expect(() => createIsolatedImageResolver("https://wrong.example", images, origin)).toThrow();
  const resolve = createIsolatedImageResolver(origin, images, origin);
  for (const src of [
    "https://other.example/x.jpg",
    "//other.example/x.jpg",
    "/\\other.example/x.jpg",
    "data:image/png;base64,AAA",
    "https://user:pass@isolated.public.blob.vercel-storage.com/x.jpg",
  ])
    expect(() => resolve(src)).toThrow();
  expect(() =>
    createIsolatedImageResolver(origin, { [original]: original }, origin)(original),
  ).toThrow();
  expect(() =>
    resolveIsolatedSrcSet(`${original} 640w, https://other.example/x.jpg 1280w`, resolve),
  ).toThrow();
});
