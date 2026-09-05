import { createHash, createHmac, timingSafeEqual } from "node:crypto";

type Intent = {
  id: string;
  staff_id: string;
  fingerprint: string;
  pathname: string;
  url: string | null;
};
type Repo = {
  claim(
    input: Intent & { contentType: string; size: number; ownerType: string },
  ): Promise<{ intent: Intent; fresh: boolean }>;
  complete(intent: Intent, url: string): Promise<void>;
};
export function createMediaUploadService({
  repo,
  put,
  secret,
}: {
  repo: Repo;
  put: (input: {
    pathname: string;
    body: File;
    contentType: string;
  }) => Promise<{ url: string; pathname: string }>;
  secret: string;
}) {
  const sign = (payload: string) =>
    createHmac("sha256", secret).update(`media-upload-v1:${payload}`).digest("hex");
  return async ({
    file,
    ownerType,
    staffId,
    uploadId,
    receipt,
  }: {
    file: File;
    ownerType: string;
    staffId: string;
    uploadId: string;
    receipt?: string;
  }) => {
    const fingerprint = createHash("sha256")
      .update(await file.arrayBuffer().then((b) => Buffer.from(b)))
      .update(`:${file.type}:${ownerType}`)
      .digest("hex");
    const claimed = await repo.claim({
      id: uploadId,
      staff_id: staffId,
      fingerprint,
      pathname: `${ownerType}/${staffId}/${uploadId}`,
      url: null,
      contentType: file.type,
      size: file.size,
      ownerType,
    });
    const intent = claimed.intent;
    if (intent.staff_id !== staffId || intent.fingerprint !== fingerprint) {
      return { ok: false as const, error: "UPLOAD_ID_CONFLICT", status: 409 };
    }
    if (intent.url) return { ok: true as const, url: intent.url, pathname: intent.pathname };
    let url: string;
    if (receipt) {
      try {
        if (receipt.length > 8192) throw new Error();
        const [payload, signature] = receipt.split(".");
        const expected = Buffer.from(sign(payload));
        const actual = Buffer.from(signature || "");
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
          throw new Error();
        const parsed = JSON.parse(Buffer.from(payload, "base64url").toString());
        if (
          parsed.id !== uploadId ||
          parsed.staffId !== staffId ||
          parsed.fingerprint !== fingerprint ||
          parsed.pathname !== intent.pathname
        )
          throw new Error();
        url = parsed.url;
      } catch {
        return { ok: false as const, error: "INVALID_UPLOAD_RECEIPT", status: 400 };
      }
    } else {
      if (!claimed.fresh)
        return { ok: false as const, error: "UPLOAD_OUTCOME_UNKNOWN", status: 409, uploadId };
      try {
        url = (await put({ pathname: intent.pathname, body: file, contentType: file.type })).url;
      } catch {
        return { ok: false as const, error: "UPLOAD_OUTCOME_UNKNOWN", status: 409, uploadId };
      }
    }
    const payload = Buffer.from(
      JSON.stringify({ id: uploadId, staffId, fingerprint, pathname: intent.pathname, url }),
    ).toString("base64url");
    const recoveryReceipt = `${payload}.${sign(payload)}`;
    try {
      await repo.complete(intent, url);
    } catch {
      return {
        ok: false as const,
        error: "UPLOAD_METADATA_PENDING",
        status: 503,
        uploadId,
        receipt: recoveryReceipt,
      };
    }
    return { ok: true as const, url, pathname: intent.pathname };
  };
}
