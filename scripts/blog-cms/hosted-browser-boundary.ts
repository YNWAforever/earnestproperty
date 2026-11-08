import type { BrowserContext, Route } from "@playwright/test";

export class BrowserBoundaryError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export type BrowserPolicy = {
  appOrigin: string;
  authOrigin: string;
  blobOrigin: string;
  session?: string;
  bypass?: string;
  // Enable only alongside the scanner's .exclude("iframe"); never grants network access.
  excludeThirdPartyIframes?: boolean;
};
export type ExcludedFrame = { code: "BROWSER_EXCLUDED_IFRAME_BLOCKED"; origin: string };

/** Browser routing does not intercept every redirected hop. Never give it a redirect to follow.
 * Fetch exactly one hop, reject every 3xx, then fulfill only the terminal response. */
export async function forwardReadOnly(route: Route, policy: BrowserPolicy, guard: () => void) {
  guard();
  const req = route.request(),
    url = new URL(req.url());
  const allowed = [policy.appOrigin, policy.authOrigin, policy.blobOrigin];
  if (
    !allowed.includes(url.origin) &&
    policy.excludeThirdPartyIframes &&
    req.isNavigationRequest() &&
    req.resourceType() === "document" &&
    req.frame().parentFrame() !== null
  ) {
    // Only a direct, credential-free GET into an excluded iframe of the owned page
    // is non-fatal. Redirects, top-level navigation and arbitrary subresources are not.
    const headers = await req.allHeaders();
    if (
      url.username ||
      url.password ||
      [
        "authorization",
        "proxy-authorization",
        "cookie",
        "x-vercel-protection-bypass",
        "x-vercel-set-bypass-cookie",
      ].some((key) => key in headers)
    )
      throw new BrowserBoundaryError("BROWSER_CREDENTIAL_REFUSED");
    if (req.redirectedFrom()) throw new BrowserBoundaryError("BROWSER_REDIRECT_ORIGIN_REFUSED");
    if (req.method() !== "GET") throw new BrowserBoundaryError("BROWSER_METHOD_REFUSED");
    const frame = req.frame(),
      parent = frame.parentFrame()!;
    if (parent === frame.page().mainFrame() && new URL(parent.url()).origin === policy.appOrigin) {
      const element = await frame.frameElement();
      const isIframe = await element.evaluate((el) => el.nodeName === "IFRAME");
      await element.dispose();
      if (isIframe) {
        guard();
        await route.abort("blockedbyclient");
        return {
          code: "BROWSER_EXCLUDED_IFRAME_BLOCKED",
          origin: url.origin,
        } satisfies ExcludedFrame;
      }
    }
  }
  if (!allowed.includes(url.origin) || url.username || url.password)
    throw new BrowserBoundaryError("BROWSER_ORIGIN_REFUSED");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method()))
    throw new BrowserBoundaryError("BROWSER_METHOD_REFUSED");
  const headers = { ...req.headers() };
  delete headers["x-vercel-protection-bypass"];
  if (url.origin === policy.appOrigin) {
    if (
      headers.authorization &&
      (!policy.session || headers.authorization !== `Bearer ${policy.session}`)
    )
      throw new BrowserBoundaryError("BROWSER_ACTOR_REFUSED");
    if (policy.bypass) headers["x-vercel-protection-bypass"] = policy.bypass;
  } else delete headers.authorization;
  const response = await route.fetch({ headers, maxRedirects: 0, maxRetries: 0, timeout: 15000 });
  try {
    guard();
    if (response.status() >= 300 && response.status() < 400) {
      const location = response.headers().location;
      const next = location ? new URL(location, url) : null;
      throw new BrowserBoundaryError(
        next && (!allowed.includes(next.origin) || next.username || next.password)
          ? "BROWSER_REDIRECT_ORIGIN_REFUSED"
          : "BROWSER_REDIRECT_REFUSED",
      );
    }
    await route.fulfill({ response });
  } finally {
    await response.dispose();
  }
}

export async function installReadBoundary(
  context: BrowserContext,
  policy: BrowserPolicy,
  guard: () => void,
  failed: (error: unknown) => void,
  excluded: (frame: ExcludedFrame) => void = () => {},
) {
  // route.fetch bypasses the browser's normal connection scheduling. Bound the
  // intercepted reads so image-heavy pages do not exhaust the transport timeout.
  let active = 0;
  const waiting: Array<() => void> = [];
  await context.route("**/*", async (route) => {
    if (active >= 4) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      const result = await forwardReadOnly(route, policy, guard);
      if (result) excluded(result);
    } catch (error) {
      failed(error);
      await route.abort("blockedbyclient");
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  });
}
