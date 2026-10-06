// No-op stand-in for `@/lib/analytics/events` in the public-forms browser fixture: the forms
// import only `track` and `buildContext`. Nothing is dispatched anywhere.
export function buildContext(partial: Record<string, unknown> = {}) {
  return { route: "", ...partial };
}

export function track(_event: unknown, _context: unknown): void {}
