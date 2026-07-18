export type OperationContext = { requestId: string; startedAt: string };

export function createOperationContext(): OperationContext {
  return { requestId: crypto.randomUUID(), startedAt: new Date().toISOString() };
}
