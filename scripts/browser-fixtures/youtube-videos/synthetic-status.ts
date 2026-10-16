import { statusCases, type StatusCase } from "./status-data";

export async function fetchYouTubeSyncStatus() {
  const name = new URLSearchParams(location.search).get("case");
  if (name === "read-error") throw new Error("SYNTHETIC_INTERNAL_SECRET: database unavailable");
  if (!name || !Object.hasOwn(statusCases, name)) throw new Error("Unknown synthetic status case");
  return { ...statusCases[name as StatusCase] };
}
