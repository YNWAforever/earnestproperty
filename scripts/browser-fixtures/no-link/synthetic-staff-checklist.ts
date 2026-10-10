// Synthetic port for the first-login checklist server functions. The shell only needs a
// definite answer; fixtures that do not test the checklist report it as already confirmed.
export async function fetchFirstLoginChecklistDone() {
  return true;
}
export async function confirmFirstLoginChecklist() {
  return { ok: true as const };
}
