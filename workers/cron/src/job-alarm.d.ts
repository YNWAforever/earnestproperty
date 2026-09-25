export function createJobAlarm(input: {
  storage: DurableObjectStorage;
  drain: () => Promise<string | null>;
  now?: () => number;
  report?: (code: string) => void;
}): {
  signal(): Promise<void>;
  fire(): Promise<void>;
};
