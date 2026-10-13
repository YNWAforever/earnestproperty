export const scenario = {
  mode: sessionStorage.getItem("layout-read-state") ?? "normal",
  failures: [] as string[],
  pending: 0,
  reads: [] as string[],
  hold: (sessionStorage.getItem("layout-read-state") ?? "").startsWith("hold:")
    ? [sessionStorage.getItem("layout-read-state")!.slice(5)]
    : ([] as string[]),
  pendingReads: [] as { name: string; release: () => void }[],
};
Object.assign(window, { adminLayoutReads: scenario });
export function read<A extends unknown[], R>(
  name: string,
  call: (...args: A) => Promise<R>,
  empty?: (value: R) => R,
) {
  return async (...args: A): Promise<R> => {
    scenario.reads.push(name);
    scenario.pending++;
    try {
      const mode = scenario.mode;
      if (mode === "error" || mode === `error:${name}`) throw Error("合成讀取暫時失敗，請重試");
      const result = await call(...args);
      if (scenario.hold.includes(name)) {
        await new Promise<void>((resolve) => {
          const pending = {
            name,
            release: () => {
              scenario.pendingReads = scenario.pendingReads.filter((item) => item !== pending);
              resolve();
            },
          };
          scenario.pendingReads.push(pending);
        });
      }
      return mode === "empty" && empty ? empty(result) : result;
    } catch (error) {
      scenario.failures.push(name);
      throw error;
    } finally {
      scenario.pending--;
    }
  };
}
