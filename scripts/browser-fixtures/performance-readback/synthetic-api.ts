export * from "../no-link/synthetic-api";
export async function fetchStaffSession() {
  const state = window.performanceReadbackFixture;
  return state.denied
    ? { status: "denied", reason: "not-staff" }
    : { status: "ok", staffId: state.binding, roles: [state.role] };
}
