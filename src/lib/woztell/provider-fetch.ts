/** Bounds the entire fetch plus streamed body, including providers that ignore abort. */
export async function boundedProviderFetch(
  url: string,
  init: RequestInit,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; maxBytes?: number } = {},
) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 15_000,
    maxBytes = options.maxBytes ?? 262_144;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const work = (async () => {
    const response = await (options.fetchImpl ?? fetch)(url, {
      ...init,
      signal: controller.signal,
    });
    if (Number(response.headers.get("content-length")) > maxBytes) {
      controller.abort();
      throw new Error("WOZTELL_RESPONSE_TOO_LARGE");
    }
    const reader = response.body?.getReader();
    activeReader = reader;
    const parts: Uint8Array[] = [];
    let size = 0;
    if (reader)
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > maxBytes) {
            controller.abort();
            void reader.cancel().catch(() => {});
            throw new Error("WOZTELL_RESPONSE_TOO_LARGE");
          }
          parts.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
        activeReader = undefined;
      }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return { response, text: new TextDecoder().decode(bytes) };
  })();
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      void activeReader?.cancel().catch(() => {});
      reject(new Error("WOZTELL_PROVIDER_TIMEOUT"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
