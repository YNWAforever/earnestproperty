import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const origin = "https://earnestproperty.com";
async function publicPage(url, fetch) {
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
    headers: { Accept: "text/html" },
  });
  if (
    response.status !== 200 ||
    !response.headers.get("content-type")?.includes("text/html") ||
    Number(response.headers.get("content-length")) > 2 * 1024 * 1024
  )
    throw Error("PUBLIC_PAGE_UNVERIFIED");
  const reader = response.body.getReader();
  let total = 0;
  const parts = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 2 * 1024 * 1024) throw Error("PUBLIC_PAGE_UNVERIFIED");
      parts.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const html = Buffer.concat(parts).toString("utf8");
  if (!html.includes("晉誠")) throw Error("PUBLIC_PAGE_UNVERIFIED");
  return html;
}
export async function verifyPublicReport(report, { fetch = globalThis.fetch } = {}) {
  if (!Array.isArray(report.published) || report.published.length > 20)
    throw Error("PUBLICATION_REPORT_INVALID");
  const aliases = report.published.map((item) => item.publicListingNo);
  if (aliases.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(id)))
    throw Error("PUBLIC_ALIAS_REQUIRED");
  await publicPage(origin + "/", fetch);
  for (const id of new Set(aliases)) {
    const html = await publicPage(origin + "/property/" + encodeURIComponent(id), fetch);
    if (!html.includes(id)) throw Error("PUBLIC_LISTING_UNVERIFIED");
  }
  return {
    homepageVerified: true,
    detailsVerified: new Set(aliases).size,
    checkedAt: new Date().toISOString(),
    browserVerification: "BLOCKED_EXTERNAL",
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== "--report" || args[2] !== "--out")
      throw Error("INVALID_ARGUMENTS");
    const bytes = await readFile(args[1]);
    if (bytes.length > 1024 * 1024) throw Error("PUBLICATION_REPORT_INVALID");
    await writeFile(
      args[3],
      JSON.stringify(await verifyPublicReport(JSON.parse(bytes.toString("utf8")))),
    );
  } catch (error) {
    console.error(/^[A-Z_]+$/.test(error.message) ? error.message : "PUBLIC_VERIFICATION_FAILED");
    process.exitCode = 1;
  }
}
