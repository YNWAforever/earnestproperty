import { expect, test } from "bun:test";
import { copyCmsLocalBackup } from "./cms-local-backup";

function recorder() {
  const messages: string[] = [];
  return {
    messages,
    notify: {
      success: (message: string) => messages.push(`success:${message}`),
      error: (message: string) => messages.push(`error:${message}`),
    },
  };
}

test("copies the local edits as JSON and says so", async () => {
  const copied: string[] = [];
  const { messages, notify } = recorder();
  const result = await copyCmsLocalBackup(
    { title: "本機標題", facilities: ["會所"] },
    { writeText: async (text) => void copied.push(text) },
    notify,
  );
  expect(result).toBeNull();
  expect(JSON.parse(copied[0])).toEqual({ title: "本機標題", facilities: ["會所"] });
  expect(messages).toEqual(["success:已複製本機修改。"]);
});

test("a refused or missing clipboard returns the text for the manual-copy box", async () => {
  for (const clipboard of [
    {
      writeText: async () => {
        throw new Error("NotAllowedError");
      },
    },
    null,
  ]) {
    const { messages, notify } = recorder();
    const result = await copyCmsLocalBackup({ title: "本機標題" }, clipboard, notify);
    expect(JSON.parse(result ?? "null")).toEqual({ title: "本機標題" });
    expect(messages).toEqual(["error:未能自動複製，請在下方手動複製。"]);
  }
});
