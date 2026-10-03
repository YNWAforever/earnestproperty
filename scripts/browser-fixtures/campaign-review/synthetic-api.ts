// Reuse the existing complete campaign presentation ports; no SQL/provider effect.
export * from "../no-link/synthetic-api";
export async function fetchStaffSession() {
  return { status: "ok", staffId: "20000000-0000-4000-8000-000000000001", roles: ["manager"] };
}
