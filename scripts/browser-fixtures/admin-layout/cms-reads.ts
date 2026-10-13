export * from "../leave-guards/synthetic-cms";
import * as base from "../leave-guards/synthetic-cms";
import { read } from "./read-control";
export const fetchAdminCmsEditor = read("fetchAdminCmsEditor", base.fetchAdminCmsEditor);
