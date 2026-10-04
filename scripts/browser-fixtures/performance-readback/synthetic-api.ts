export * from "../no-link/synthetic-api";
export async function fetchStaffSession() {
  const state = window.performanceReadbackFixture;
  if (state.staffMode === "delayed")
    await new Promise<void>((release) => state.pending.push({ release }));
  return state.denied
    ? { status: "denied", reason: "not-staff" }
    : { status: "ok", staffId: state.binding, roles: [state.role] };
}
