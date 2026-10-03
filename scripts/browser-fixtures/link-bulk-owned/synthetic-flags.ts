import { finalFixUiFlags as shared } from "../no-link/synthetic-flags";
// Test fixture only; no production flag/config changes.
export const finalFixUiFlags = {
  ...shared,
  linkBatchImport: sessionStorage.getItem("owned-link-bulk-import-enabled") !== "false",
};
