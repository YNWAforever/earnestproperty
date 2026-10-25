import pg from "pg";
export async function createSavedImportClient(config, driver = "pg") {
  if (driver === "pg") return new pg.Client(config);
  if (driver !== "neon-ws") throw Error("IMPORT_DRIVER_INVALID");
  const [{ Client }, { default: WebSocket }] = await Promise.all([
    import("@neondatabase/serverless"),
    import("ws"),
  ]);
  const client = new Client(config);
  client.neonConfig.webSocketConstructor = WebSocket;
  // Keep one session for transactions, advisory locks and local settings; never use HTTP neon().
  return client;
}
