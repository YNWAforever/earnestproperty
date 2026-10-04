// Reuse the existing complete campaign presentation ports; no SQL/provider effect.
export * from "../no-link/synthetic-api";
export const membership = { role: "manager", binding: "20000000-0000-4000-8000-000000000001" };
export async function fetchStaffSession() {
  return { status: "ok", staffId: membership.binding, roles: [membership.role] };
}
