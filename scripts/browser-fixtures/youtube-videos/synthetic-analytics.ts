// Analytics has no transport in owned synthetic evidence.
export function buildContext() {
  return {};
}

export function track(_event: unknown, _context: unknown) {}
