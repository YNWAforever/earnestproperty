// Synthetic stand-in for `@/lib/neon/admin-data` in the public-forms browser fixture. Only the
// server functions the four public enquiry forms import are provided. Each call is recorded
// synchronously (before any await) and settles according to `publicFormsFixture.mode`, so a spec
// can drive every outcome the real TanStack server-fn call can produce. No DB, auth or network.
export type PublicFormsFixtureMode =
  | "success"
  | "rate-limited-response"
  | "no-id"
  | "network"
  | "hold";
const held: (() => void)[] = [];
const state = {
  mode: "success" as PublicFormsFixtureMode,
  calls: [] as { name: string; input: unknown }[],
  /** Settles every call made in `hold` mode as a success. */
  release() {
    for (const settle of held.splice(0)) settle();
  },
};
declare global {
  interface Window {
    publicFormsFixture: typeof state;
  }
}
window.publicFormsFixture = state;

function respond(name: string, input: unknown): Promise<unknown> {
  state.calls.push({ name, input });
  switch (state.mode) {
    case "success":
      return Promise.resolve({ id: "fixture-id" });
    case "rate-limited-response":
      // TanStack Start resolves (not rejects) a rate-limited server-fn call with the Response.
      return Promise.resolve(new Response("Too Many Requests", { status: 429 }));
    case "no-id":
      return Promise.resolve({});
    case "network":
      return Promise.reject(new TypeError("Failed to fetch"));
    case "hold":
      return new Promise((resolve) => held.push(() => resolve({ id: "fixture-id" })));
  }
}

export const createWebsiteInquiry = (input: unknown) => respond("createWebsiteInquiry", input);
export const createValuationLead = (input: unknown) => respond("createValuationLead", input);
export const createListingAlert = (input: unknown) => respond("createListingAlert", input);
