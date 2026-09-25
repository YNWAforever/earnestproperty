const MAX_PUBLIC_JSON_BYTES = 16 * 1024;

export async function readPublicJsonBody(request: Request): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PUBLIC_JSON_BYTES) {
    throw new Response("Request body too large", { status: 413 });
  }

  const reader = request.body?.getReader();
  if (!reader) return {};

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_PUBLIC_JSON_BYTES) {
        void reader.cancel().catch(() => {});
        throw new Response("Request body too large", { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
