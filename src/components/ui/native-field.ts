// FX-20 (20b Task 3): one class string for the admin's native <select>s, so they match the
// 44 px Input/Select primitives (3:1 field border, 2 px focus ring with a background gap).
// A string, not a component: call sites keep their own width/margin via cn(nativeFieldClassName, …).
// `border-input!` is !important because the neon-auth layer's `* { border-color }` outranks
// every plain border-colour utility (same as input.tsx, textarea.tsx and select.tsx).
export const nativeFieldClassName =
  "h-11 w-full rounded-md border border-input! bg-background px-3 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";
