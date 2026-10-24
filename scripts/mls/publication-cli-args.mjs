export function parsePublicationArgs(args) {
  const names = {
    "--payload": "payloadPath",
    "--report": "reportPath",
    "--publication-plan": "publicationPlanPath",
    "--publication-plan-hash": "publicationPlanHash",
  };
  const parsed = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = names[args[i]],
      value = args[i + 1];
    if (
      !key ||
      Object.hasOwn(parsed, key) ||
      typeof value !== "string" ||
      !value.trim() ||
      value.startsWith("--")
    )
      throw Error("INVALID_ARGUMENTS");
    parsed[key] = value;
  }
  if (
    !parsed.payloadPath ||
    !parsed.reportPath ||
    (parsed.publicationPlanPath !== undefined) !== (parsed.publicationPlanHash !== undefined) ||
    (parsed.publicationPlanHash !== undefined && !/^[a-f0-9]{64}$/.test(parsed.publicationPlanHash))
  )
    throw Error("INVALID_ARGUMENTS");
  return parsed;
}
