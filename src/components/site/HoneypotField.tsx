import { useId, type Ref } from "react";

import { HONEYPOT_FIELD } from "@/lib/public-form-honeypot";

/**
 * Invisible honeypot for the public forms. Off-screen, never display:none (bots skip hidden
 * inputs), hidden from assistive tech, out of the tab order and free of any constraint the
 * browser could enforce, so it can never block a real submission. A filled value only flags
 * the enquiry server-side; see src/lib/public-form-honeypot.ts. The parent <form> must be
 * `relative` so the field is positioned against it.
 */
export function HoneypotField({ inputRef }: { inputRef?: Ref<HTMLInputElement> }) {
  const id = useId();
  return (
    <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
      <label htmlFor={id}>請勿填寫此欄</label>
      <input
        id={id}
        name={HONEYPOT_FIELD}
        type="text"
        tabIndex={-1}
        autoComplete="off"
        defaultValue=""
        ref={inputRef}
      />
    </div>
  );
}
