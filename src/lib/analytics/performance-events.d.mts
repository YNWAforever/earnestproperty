import type { PerformanceEventInput } from "./performance-events.ts";
export function performanceEventKey(type: PerformanceEventInput["type"], sourceId: string): string;
export function validatePerformanceEvent(event: PerformanceEventInput): PerformanceEventInput & {
  idempotencyKey: string;
  sourceId: string;
};
export function buildRecordPerformanceEventQuery(event: PerformanceEventInput): {
  statement: string;
  params: unknown[];
};
