export function handlePropertyhkRequest(
  request: Request,
  options: {
    secret?: string;
    connectionString?: string;
    ingest: (
      payload: unknown,
      options: { apply: boolean; expectedSource: "propertyhk"; connectionString?: string },
    ) => Promise<unknown>;
    maxBytes?: number;
    bodyTimeoutMs?: number;
  },
): Promise<Response>;
