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
};

/** Browser routing does not intercept every redirected hop. Never give it a redirect to follow.
 * Fetch exactly one hop, reject every 3xx, then fulfill only the terminal response. */
export async function forwardReadOnly(route: Route, policy: BrowserPolicy, guard: () => void) {
  guard();
  const req = route.request(),
    url = new URL(req.url());
  const allowed = [policy.appOrigin, policy.authOrigin, policy.blobOrigin];
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
) {
  await context.route("**/*", async (route) => {
    try {
      await forwardReadOnly(route, policy, guard);
    } catch (error) {
      failed(error);
      await route.abort("blockedbyclient");
    }
  });
}
