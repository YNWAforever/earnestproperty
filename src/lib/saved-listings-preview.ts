// Vite injects only the public Vercel deployment label for consistent SSR/hydration.
// Production stays opt-in; preview deployments automatically show saved inventory.
export const savedListingsPreview =
  import.meta.env.VITE_28HSE_PREVIEW === "true" || import.meta.env.VITE_VERCEL_ENV === "preview";
