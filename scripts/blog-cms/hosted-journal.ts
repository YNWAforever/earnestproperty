import assert from "node:assert/strict";
import * as fs from "node:fs";
import { join } from "node:path";
import { digest } from "./hosted-contract";

type JournalIO = Pick<
  typeof fs,
  "openSync" | "writeFileSync" | "fsyncSync" | "closeSync" | "renameSync" | "existsSync"
>;
type RecordFile = { data: unknown; hash: string };
/** Each committed file is immutable. A torn/pending next generation never replaces a good one.
 * The optional IO is a filesystem fault seam only; it cannot grant hosted authority. */
export function createRecoveryJournal(directory: string, io: JournalIO = fs) {
  const lock = io.openSync(join(directory, "writer.lock"), "wx");
  io.closeSync(lock);
  let sequence = 0,
    previous: string | null = null,
    baselineHash: string | null = null,
    poisoned = false;
  const publish = (name: string, data: unknown) => {
    assert.equal(poisoned, false, "JOURNAL_WRITE_PREVIOUSLY_FAILED");
    const target = join(directory, name),
      pending = target + ".pending";
    assert.equal(io.existsSync(target), false, "JOURNAL_IMMUTABLE_FILE_EXISTS");
    let fd: number | undefined;
    try {
      fd = io.openSync(pending, "wx");
      const hash = digest(data);
      io.writeFileSync(fd, JSON.stringify({ data, hash }) + "\n");
      io.fsyncSync(fd);
      io.closeSync(fd);
      fd = undefined;
      io.renameSync(pending, target);
      return hash;
    } catch (error) {
      poisoned = true;
      throw error;
    } finally {
      if (fd !== undefined) io.closeSync(fd);
    }
  };
  return {
    baseline(data: unknown) {
      assert.equal(baselineHash, null, "BASELINE_ALREADY_SEALED");
      baselineHash = publish("baseline.json", data);
      return baselineHash;
    },
    append(payload: unknown) {
      const next = sequence + 1;
      previous = publish(`journal-${String(next).padStart(8, "0")}.json`, {
        sequence: next,
        previous,
        baselineHash,
        payload,
      });
      sequence = next;
    },
  };
}

/** Read-only recovery inspection. Never resumes execution or repairs a partial file. */
export function readRecoveryJournal(directory: string) {
  const read = (name: string): RecordFile => {
    const value = JSON.parse(fs.readFileSync(join(directory, name), "utf8")) as RecordFile;
    assert.equal(value.hash, digest(value.data), "JOURNAL_DIGEST_MISMATCH");
    return value;
  };
  const baseline = fs.existsSync(join(directory, "baseline.json")) ? read("baseline.json") : null;
  let previous: string | null = null,
    sequence = 0;
  const entries = fs
    .readdirSync(directory)
    .filter((n) => /^journal-\d{8}\.json$/.test(n))
    .sort()
    .map((name) => {
      const record = read(name),
        data = record.data as {
          sequence: number;
          previous: string | null;
          baselineHash: string | null;
          payload: unknown;
        };
      assert.equal(data.sequence, ++sequence, "JOURNAL_SEQUENCE_GAP");
      assert.equal(data.previous, previous, "JOURNAL_CHAIN_MISMATCH");
      if (data.baselineHash !== null)
        assert.equal(data.baselineHash, baseline?.hash, "JOURNAL_BASELINE_MISMATCH");
      previous = record.hash;
      return data;
    });
  return {
    baseline: baseline?.data,
    entries,
    pending: fs.readdirSync(directory).filter((n) => n.endsWith(".pending")),
    status: "RECOVERY_INSPECTION_NOT_ACCEPTANCE" as const,
  };
}
