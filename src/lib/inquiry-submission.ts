/** Retain only an opaque ID and payload digest, never contact text. */
const pending = new Map<string, string>();

export async function submitWithInquiryIdentity<T extends object, R extends { id?: string }>(
  payload: T,
  submit: (input: T & { submissionId: string }) => Promise<R>,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = typeof window ===
  "undefined"
    ? null
    : (() => {
        try {
          return window.sessionStorage;
        } catch {
          return null;
        }
      })(),
): Promise<R> {
  const normalized = Object.fromEntries(
    Object.entries(payload)
      .filter(([key]) => key !== "submissionId")
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(normalized))),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const key = "earnest:inquiry:pending:" + digest;
  let id = pending.get(key);
  try {
    id ||= storage?.getItem(key) ?? undefined;
  } catch {
    /* in-memory retry still works */
  }
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) id = crypto.randomUUID();
  pending.set(key, id);
  try {
    storage?.setItem(key, id);
  } catch {
    /* storage may be disabled */
  }
  const result = await submit({ ...payload, submissionId: id });
  if (result.id) {
    pending.delete(key);
    try {
      storage?.removeItem(key);
    } catch {
      /* no private data stored */
    }
  }
  return result;
}
