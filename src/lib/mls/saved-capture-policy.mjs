// Secondary approval is restricted to this operator-only, partial import path.
export const SAVED_CAPTURE_PARSER = "saved-capture-import-v1";
export function savedCaptureParserApproved(policy) {
  const approval = policy?.config?.saved_capture_import;
  return (
    approval?.parser_version === SAVED_CAPTURE_PARSER &&
    approval.approved === true &&
    typeof approval.approved_by === "string" &&
    Boolean(approval.approved_by.trim())
  );
}
export function isApprovedSavedCapture(policy, batch, options) {
  return (
    options.savedCaptureImport === true &&
    options.controlledPatch === true &&
    batch.source === "28hse_agent_540" &&
    batch.scopeId === "agent:540" &&
    batch.parserVersion === SAVED_CAPTURE_PARSER &&
    savedCaptureParserApproved(policy)
  );
}
