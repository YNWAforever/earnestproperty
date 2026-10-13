export * from "../property-maintenance/synthetic-api";
import * as base from "../property-maintenance/synthetic-api";
import { read } from "./read-control";
export const fetchAdminManagedProperty = read(
  "fetchAdminManagedProperty",
  base.fetchAdminManagedProperty,
);
export const fetchAdminPropertyGroups = read(
  "fetchAdminPropertyGroups",
  base.fetchAdminPropertyGroups,
  (value) => ({ ...value, rows: [], total: 0 }),
);
export const fetchAdminDistrictOptions = read(
  "fetchAdminDistrictOptions",
  base.fetchAdminDistrictOptions,
);
