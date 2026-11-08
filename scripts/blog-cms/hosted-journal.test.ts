import { test, expect } from "bun:test";
import * as fs from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRecoveryJournal, readRecoveryJournal } from "./hosted-journal";

const temporary = () => fs.mkdtempSync(join(tmpdir(), "task7-journal-"));
const remove = (dir: string) => {
  expect(dirname(resolve(dir))).toBe(resolve(tmpdir()));
  fs.rmSync(dir, { recursive: true, force: true });
};
for (const stage of ["write", "sync", "rename"] as const)
  test(`LOCAL_FS: ${stage} failure preserves immutable baseline and previous journal`, () => {
    const dir = temporary();
    let fail = false;
    const io = {
      ...fs,
      writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
        if (fail && stage === "write") {
          fs.writeFileSync(args[0], "{torn");
          throw new Error("INJECTED_WRITE_FAILURE");
        }
        fs.writeFileSync(...args);
      },
      fsyncSync: (fd: number) => {
        if (fail && stage === "sync") throw new Error("INJECTED_SYNC_FAILURE");
        fs.fsyncSync(fd);
      },
      renameSync: (...args: Parameters<typeof fs.renameSync>) => {
        if (fail && stage === "rename") throw new Error("INJECTED_RENAME_FAILURE");
        fs.renameSync(...args);
      },
    };
    try {
      const writer = createRecoveryJournal(dir, io);
      writer.baseline({ rows: [{ id: "owned", title: "baseline" }] });
      writer.append({ intent: "before-first-write" });
      const baseline = fs.readFileSync(join(dir, "baseline.json")),
        previous = fs.readFileSync(join(dir, "journal-00000001.json"));
      fail = true;
      expect(() => writer.append({ intent: "must-not-dispatch" })).toThrow("INJECTED_");
      expect(fs.readFileSync(join(dir, "baseline.json"))).toEqual(baseline);
      expect(fs.readFileSync(join(dir, "journal-00000001.json"))).toEqual(previous);
      const recovery = readRecoveryJournal(dir);
      expect(recovery.entries).toHaveLength(1);
      expect(recovery.pending).toHaveLength(1);
      expect(() => writer.append({ intent: "cannot-continue" })).toThrow(
        "JOURNAL_WRITE_PREVIOUSLY_FAILED",
      );
      expect(() => writer.baseline({ rows: [] })).toThrow("BASELINE_ALREADY_SEALED");
    } finally {
      remove(dir);
    }
  });
test("LOCAL_PROCESS: termination before rename leaves previous committed recovery generation", () => {
  const dir = temporary();
  try {
    const code = `import * as fs from 'node:fs'; import {createRecoveryJournal} from ${JSON.stringify(import.meta.resolve("./hosted-journal"))}; const writer=createRecoveryJournal(process.argv[1],{...fs,renameSync:(a,b)=>{if(String(b).endsWith('00000002.json'))process.exit(23);fs.renameSync(a,b);}});writer.baseline({snapshot:'immutable'});writer.append({intent:1});writer.append({intent:2});`;
    const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code, dir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(23);
    const recovered = readRecoveryJournal(dir);
    expect(recovered.baseline).toEqual({ snapshot: "immutable" });
    expect(recovered.entries).toHaveLength(1);
    expect(recovered.pending).toHaveLength(1);
  } finally {
    remove(dir);
  }
});
