export const scenario = {
  mode: sessionStorage.getItem("layout-read-state") ?? "normal",
  failures: [] as string[],
  pending: 0,
  reads: [] as string[],
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
      if (scenario.mode === "error") throw Error("合成讀取暫時失敗，請重試");
      const result = await call(...args);
      return scenario.mode === "empty" && empty ? empty(result) : result;
    } catch (error) {
      scenario.failures.push(name);
      throw error;
    } finally {
      scenario.pending--;
    }
  };
}
