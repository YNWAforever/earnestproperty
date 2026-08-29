/** Every layout primitive extends this so its props accept arbitrary
 * data-* attributes -- React.HTMLAttributes has no such catch-all, and
 * TypeScript's data-* / aria-* leniency only applies to JSX syntax, not to
 * React.createElement's object-literal props (which is how this repo's
 * bun:test component tests are written). Without this, passing
 * data-testid to createElement(Component, {...}) fails tsc's excess-
 * property check even though the identical JSX usage would be fine. */
export type DataAttributes = {
  [key: `data-${string}`]: string | number | boolean | undefined;
};
