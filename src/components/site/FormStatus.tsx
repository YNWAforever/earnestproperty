export type FormStatusState =
  | { kind: "idle" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

/**
 * Inline result line for public enquiry forms, rendered under the submit
 * button. A toast alone is transient and easy to miss, so the outcome is also
 * written into the page: role="alert" for failures (announced immediately) and
 * role="status" for success (announced politely).
 */
export function FormStatus({ state, id }: { state: FormStatusState; id?: string }) {
  if (state.kind === "idle") return null;

  if (state.kind === "error") {
    return (
      <p
        id={id}
        role="alert"
        className="w-full rounded-md bg-destructive/10 px-3 py-2 text-sm leading-relaxed text-destructive"
      >
        {state.message}
      </p>
    );
  }

  return (
    <p
      id={id}
      role="status"
      className="w-full rounded-md bg-primary/10 px-3 py-2 text-sm leading-relaxed text-primary"
    >
      {state.message}
    </p>
  );
}
