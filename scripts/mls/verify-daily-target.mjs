import { pathToFileURL } from "node:url";

export function verifyDailyTarget(connectionString, expectedHost) {
  try {
    const url = new URL(connectionString);
    if (
      !expectedHost ||
      [...url.searchParams.keys()].some((key) => !["sslmode", "channel_binding"].includes(key)) ||
      !expectedHost.endsWith(".neon.tech") ||
      url.hostname !== expectedHost ||
      url.hostname.includes("-pooler.") ||
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      url.pathname !== "/neondb" ||
      (url.port && url.port !== "5432")
    )
      throw new Error();
    return true;
  } catch {
    throw new Error("DAILY_DATABASE_TARGET_UNVERIFIED");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    verifyDailyTarget(
      process.env.DATABASE_URL_UNPOOLED,
      process.env.PROPERTY_SYNC_EXPECTED_DATABASE_HOST,
    );
    console.log("Daily database target verified");
  } catch {
    console.error("DAILY_DATABASE_TARGET_UNVERIFIED");
    process.exitCode = 1;
  }
}
