export * from "../property-sync/synthetic-api";
import * as base from "../property-sync/synthetic-api";
import { read } from "./read-control";
export const fetchAdminSyncWorkspace = read(
  "fetchAdminSyncWorkspace",
  base.fetchAdminSyncWorkspace,
);
export const fetchWithdrawalCandidates = read(
  "fetchWithdrawalCandidates",
  base.fetchWithdrawalCandidates,
);
