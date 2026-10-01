export function workflowCapability(source, env = process.env) {
  if (source !== "28hse_agent_540")
    return { enabled: false, reason: "Property.hk 正式入口及三分行驗收尚未完成" };
  if (env.PROPERTY_SYNC_ADMIN_DISPATCH_ENABLED !== "true")
    return { enabled: false, reason: "未啟用受控同步操作" };
  if (!env.PROPERTY_SYNC_WORKFLOW_TOKEN)
    return { enabled: false, reason: "缺少 PROPERTY_SYNC_WORKFLOW_TOKEN 接駁" };
  if (env.PROPERTY_SYNC_EXPECTED_BRANCH !== "main")
    return { enabled: false, reason: "正式分支設定未核實" };
  return { enabled: true, reason: null };
}
export async function dispatchPropertySync(
  { source, operation, requestAsset, operationId },
  { env = process.env, fetchImpl = fetch } = {},
) {
  if (!workflowCapability(source, env).enabled) throw Error("WORKFLOW_CAPABILITY_UNAVAILABLE");
  const modes = { collect: "apply", ingestion: "replay-apply", publication: "publication-only" };
  if (
    !modes[operation] ||
    (operation !== "collect" && !/^request-[0-9]+-[0-9]+\.json$/.test(requestAsset ?? "")) ||
    !/^[a-f0-9-]{36}$/i.test(operationId ?? "")
  )
    throw Error("INVALID_DISPATCH");
  const response = await fetchImpl(
    "https://api.github.com/repos/YNWAforever/earnestproperty/actions/workflows/property-sync-daily.yml/dispatches",
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + env.PROPERTY_SYNC_WORKFLOW_TOKEN,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          mode: modes[operation],
          scope: "agent:540",
          bootstrap: "false",
          replay_asset: operation === "collect" ? "" : requestAsset,
          operation_id: operationId,
        },
      }),
    },
  );
  await response.body?.cancel();
  return {
    accepted: response.status === 204,
    rejected: response.status >= 400 && response.status < 500,
  };
}
