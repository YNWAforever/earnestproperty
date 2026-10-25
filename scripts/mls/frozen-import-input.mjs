import { open } from "node:fs/promises";
import { createHash } from "node:crypto";

// Hash and parse exactly these bytes. Never reopen the input after confirmation.
export async function readFrozenImportInput(path) {
  const file = await open(path, "r");
  try {
    const before = await file.stat();
    const max = 20 * 1024 * 1024;
    if (!before.isFile() || before.size > max) throw Error("IMPORT_INPUT_TOO_LARGE_OR_NOT_FILE");
    const buffer = Buffer.alloc(max + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await file.stat();
    if (length > max) throw Error("IMPORT_INPUT_TOO_LARGE");
    if (
      before.size !== length ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw Error("IMPORT_INPUT_CHANGED_DURING_READ");
    const bytes = buffer.subarray(0, length);
    return {
      bytes,
      inputSha256: createHash("sha256").update(bytes).digest("hex"),
      capturedAt: before.mtime.toISOString(),
    };
  } finally {
    await file.close();
  }
}
