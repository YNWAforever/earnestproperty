export function latestRunPublisher(run) {
  return ["28hse_agent_540", "propertyhk"].some(
    (source) =>
      run?.sourceStatus?.[source]?.policy_version === "no-hermes-v2" &&
      run?.sourceStatus?.[source]?.publisher === "python-snapshot-v2",
  )
    ? "python-snapshot-v2"
    : "cloudflare-container";
}
