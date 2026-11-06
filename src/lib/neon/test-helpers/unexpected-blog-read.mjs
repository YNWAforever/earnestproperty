// Non-blog public-data tests exercise real listing/corridor SQL with an injected DB.
// Keep the unrelated blog server dependency out of their shallow data-URL loaders.
// Never run its callback: an accidental blog path must fail before any query.
export const unexpectedBlogReadUrl = `data:text/javascript;base64,${Buffer.from(
  `
  export async function publicBlogRead() {
    throw new Error("Unexpected blog read in a non-blog public-data test");
  }
  export { publicBlogRead as publicCall };
`,
).toString("base64")}`;
