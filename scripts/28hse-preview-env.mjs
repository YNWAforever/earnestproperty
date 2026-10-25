// Expose only the public deployment label, identically in client and SSR builds.
// VERCEL_ENV is authoritative: a stale VITE_ hint must not enable production.
export function previewDeploymentDefines(env = process.env) {
  return {
    "import.meta.env.VITE_VERCEL_ENV": JSON.stringify(env.VERCEL_ENV ?? env.VITE_VERCEL_ENV ?? ""),
  };
}
