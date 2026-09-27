type FinalFixUiEnvironment = Record<string, unknown>;

export function resolveFinalFixUiFlags(env: FinalFixUiEnvironment, production: boolean) {
  const enabled = (name: string) =>
    env[name] === "true" || (env[name] === undefined && !production);

  return {
    staffDirectorySetup: enabled("VITE_STAFF_DIRECTORY_SETUP"),
    staffReviewEnforcement: enabled("VITE_STAFF_REVIEW_ENFORCEMENT"),
    linkBatchImport: enabled("VITE_LINK_BATCH_IMPORT"),
    salesPerformanceReporting: enabled("VITE_SALES_PERFORMANCE_REPORTING"),
  };
}

export const finalFixUiFlags = resolveFinalFixUiFlags(import.meta.env, import.meta.env.PROD);
